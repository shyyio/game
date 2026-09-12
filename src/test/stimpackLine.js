// Builds the full production chain, end to end, as a real placed factory
// (extractors, machines, belts, pipes, Trading Terminals) — not scripted item-shuttling. Every
// producer instance hands into exactly one consumer port (a tree, never a shared fan-out network), so
// placement uses a simple tree layout: each leaf gets its own horizontal lane, each internal node
// inherits its leftmost child's lane, and a node's children sit as far south as that node's own
// body and connectors need (root/Fill north, leaves south, matching this game's north-flowing port
// convention — see project_pipe_port_geometry).

import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {Direction} from "@/common/constants.js";
import {chunkOrdinal} from "@/common/util.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";
import {PipeType} from "@/mods/fluids/common/objectTypes.js";
import {
    ExtractorType,
    WaterResourceType,
    GraveyardResourceType,
    OxideDepositResourceType,
    CoalDepositResourceType,
    QuartzDepositResourceType,
    GreenhouseType,
    BlenderType,
    SpawningPoolType,
    TormentChamberType,
    BrewType,
    BakeType,
    BlastFurnaceType,
    FormingMachineType,
    DelicateAssemblyType,
    FillType,
    AirFilterType,
} from "@/mods/base-game/common/objectTypes.js";
import {
    ITEM_TYPE_CABBAGE_SEED,
    ITEM_TYPE_MUSHROOM_SPORE,
    NPC_PRICE_CABBAGE_SEED,
    NPC_PRICE_MUSHROOM_SPORE,
} from "@/mods/base-game/common/constants.js";
import {TradingTerminalType} from "@/mods/market/common/objectTypes.js";
import {ConfigureTradingTerminalMessage} from "@/mods/market/common/messages.js";
import {MARKET_MODE_BUY, MARKET_SETTING_BALANCE} from "@/mods/market/common/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";

// Column spacing between sibling leaf lanes: the widest object is 3 tiles, and a connector climbs in
// the column of the port it leaves or enters, never beside it.
const LANE_WIDTH = 3;

// The player this factory is built for: pre-funded and pre-claimed, so its two NPC-buy Trading
// Terminals are live from tick one (no session needs to claim/configure anything by hand).
export const STIMPACK_FACTORY_PLAYER_REF = 1;
const STARTING_BALANCE = 100000;

/**
 * @param {string} name label only, for readability while debugging a layout
 * @param {ObjectType} type
 * @param {Array<{portIndex: number, child: object}>} children
 * @returns {object}
 */
function machineNode(name, type, children = []) {
    return {kind: "machine", name, type, children};
}

/**
 * @param {ObjectType} resourceType
 * @returns {object}
 */
function resourceLeaf(resourceType) {
    return {kind: "resource", name: resourceType.name, resourceType, children: []};
}

/**
 * @param {number} itemTypeId
 * @param {number} price
 * @returns {object}
 */
function terminalLeaf(itemTypeId, price) {
    return {kind: "terminal", name: "TradingTerminal", itemTypeId, price, children: []};
}

// The whole chain, root (Fill, makes Stimpack) down to leaves (raw resources / NPC buy orders).
// Every ObjectType here only ever receives one recipe's worth of inputs at its one placed
// instance, so MachineBehavior self-selects the right recipe — no explicit recipe index needed.
function buildTree() {
    return machineNode("Fill", FillType, [
        {portIndex: 0, child: machineNode("DelicateAssembly", DelicateAssemblyType, [
            {portIndex: 0, child: machineNode("FormingMachine", FormingMachineType, [
                {portIndex: 0, child: machineNode("BlastFurnace", BlastFurnaceType, [
                    {portIndex: 0, child: resourceLeaf(OxideDepositResourceType)},
                    {portIndex: 1, child: machineNode("Bake(Coke)", BakeType, [
                        {portIndex: 0, child: resourceLeaf(CoalDepositResourceType)},
                    ])},
                    {portIndex: 2, child: machineNode("AirFilter", AirFilterType)},
                ])},
            ])},
            {portIndex: 1, child: machineNode("Bake(Glass)", BakeType, [
                {portIndex: 0, child: resourceLeaf(QuartzDepositResourceType)},
            ])},
        ])},
        {portIndex: 1, child: machineNode("Brew(Overload)", BrewType, [
            {portIndex: 0, child: machineNode("TormentChamber", TormentChamberType, [
                {portIndex: 0, child: machineNode("SpawningPool", SpawningPoolType, [
                    {portIndex: 0, child: machineNode("Blender", BlenderType, [
                        {portIndex: 0, child: machineNode("Greenhouse(Food)", GreenhouseType, [
                            {portIndex: 0, child: terminalLeaf(ITEM_TYPE_CABBAGE_SEED, NPC_PRICE_CABBAGE_SEED)},
                            {portIndex: 1, child: resourceLeaf(WaterResourceType)},
                        ])},
                    ])},
                    {portIndex: 1, child: resourceLeaf(GraveyardResourceType)},
                ])},
            ])},
            {portIndex: 1, child: machineNode("Brew(Base)", BrewType, [
                {portIndex: 0, child: machineNode("Greenhouse(Mushroom)", GreenhouseType, [
                    {portIndex: 0, child: terminalLeaf(ITEM_TYPE_MUSHROOM_SPORE, NPC_PRICE_MUSHROOM_SPORE)},
                    {portIndex: 1, child: resourceLeaf(WaterResourceType)},
                ])},
                {portIndex: 1, child: resourceLeaf(WaterResourceType)},
            ])},
        ])},
    ]);
}

/**
 * Leaves get a unique lane (leftmost-first DFS order); an internal node inherits its leftmost
 * child's lane, keeping every node directly above (or beside, for non-leftmost children) its own
 * subtree — no two sibling subtrees ever share a lane.
 * @param {object} node
 * @param {{next: number}} counter
 * @returns {number}
 */
function assignLanes(node, counter) {
    if (node.children.length === 0) {
        node.lane = counter.next;
        counter.next += 1;
        return node.lane;
    }
    let lane = null;
    for (const edge of node.children) {
        const childLane = assignLanes(edge.child, counter);
        if (lane === null) {
            lane = childLane;
        }
    }
    node.lane = lane;
    return node.lane;
}

/**
 * The lane-relative column a node's output climbs in.
 * @param {object} node
 * @returns {number}
 */
function outputColumn(node) {
    return node.lane * LANE_WIDTH + placedType(node).outputPorts[0].x;
}

/**
 * The lane-relative column one of a node's input ports takes from.
 * @param {object} node
 * @param {number} portIndex
 * @returns {number}
 */
function inputColumn(node, portIndex) {
    return node.lane * LANE_WIDTH + placedType(node).inputPorts[portIndex].x;
}

/**
 * The rows between a node's own row and its children's: its body, the connector row beneath it, and
 * one row per child whose path jogs sideways, since two jogs crossing each other need separate rows.
 * @param {object} node
 * @returns {number}
 */
function tierHeight(node) {
    let jogs = 0;
    for (const edge of node.children) {
        if (outputColumn(edge.child) !== inputColumn(node, edge.portIndex)) {
            jogs += 1;
        }
    }
    if (jogs === 0) {
        jogs = 1;
    }
    return placedType(node).geometry.extent.y + 2 + jogs;
}

/**
 * @param {object} node
 * @param {number} row rows south of the root (Fill), which sits at 0
 * @returns {void}
 */
function assignRows(node, row) {
    node.row = row;
    const height = tierHeight(node);
    for (const edge of node.children) {
        assignRows(edge.child, row + height);
    }
}

/**
 * The ObjectType a node actually places: a resource carries an Extractor, a terminal a Trading
 * Terminal, a machine its own type.
 * @param {object} node
 * @returns {ObjectType}
 */
function placedType(node) {
    if (node.kind === "resource") {
        return ExtractorType;
    }
    if (node.kind === "terminal") {
        return TradingTerminalType;
    }
    return node.type;
}

/**
 * The chain with every node's lane and row assigned, ready to place.
 * @returns {object} the root (Fill) node
 */
function layoutTree() {
    const tree = buildTree();
    assignLanes(tree, {next: 0});
    assignRows(tree, 0);
    return tree;
}

const LAYOUT = layoutTree();

// The tile box one factory occupies, anchored at the root (Fill) tile: lanes run east, children
// south. Connector paths stay inside it, since every path runs between a node and its own child
// within the lane span of their subtree.
const FACTORY_WIDTH = maxOf(LAYOUT, node => node.lane * LANE_WIDTH + placedType(node).geometry.extent.x + 1);
const FACTORY_HEIGHT = maxOf(LAYOUT, node => node.row + placedType(node).geometry.extent.y + 1);

/**
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
function tileKeyAt(x, y) {
    return `${x},${y}`;
}

/**
 * Marks every tile of a footprint anchored at (x, y) as occupied, so connector paths (laid out
 * later) never route through a placed object's own body.
 * @param {Set<string>} occupied
 * @param {ObjectType} type
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function markFootprint(occupied, type, x, y) {
    const extent = type.geometry.extent;
    for (let dy = 0; dy <= extent.y; dy += 1) {
        for (let dx = 0; dx <= extent.x; dx += 1) {
            occupied.add(tileKeyAt(x + dx, y + dy));
        }
    }
}

/**
 * Places one node's own object(s), records the absolute tile of the output port a parent edge
 * should connect to, and reserves its footprint so no connector ever routes through it.
 * @param {GameEngine} engine
 * @param {object} node
 * @param {number} originX
 * @param {number} originY
 * @param {Set<string>} occupied
 * @returns {void}
 */
function placeNode(engine, node, originX, originY, occupied) {
    node.x = originX + node.lane * LANE_WIDTH;
    node.y = originY + node.row;
    if (node.kind === "resource") {
        engine.applyMessage(new CreateObjectMessage(node.resourceType.objectTypeId, node.x, node.y, Direction.UP));
        engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, node.x, node.y, Direction.UP));
        markFootprint(occupied, ExtractorType, node.x, node.y);
    } else if (node.kind === "terminal") {
        engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, node.x, node.y, Direction.UP));
        const eid = engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId).at(-1);
        node.objectRef = engine.placed.getObjectRefByEid(eid);
        markFootprint(occupied, TradingTerminalType, node.x, node.y);
    } else {
        engine.applyMessage(new CreateObjectMessage(node.type.objectTypeId, node.x, node.y, Direction.UP));
        markFootprint(occupied, node.type, node.x, node.y);
    }
    for (const edge of node.children) {
        placeNode(engine, edge.child, originX, originY, occupied);
    }
}

/**
 * Configures every Trading Terminal leaf to buy its NPC-priced item, using the objectRef placeNode
 * captured for it directly — never re-queried after the fact, since by the time every terminal is
 * placed there's no way to tell them apart by "the last one created".
 * @param {Game} game
 * @param {object} node
 * @returns {void}
 */
function configureTerminals(game, node) {
    if (node.kind === "terminal") {
        const session = new CapturingSession(STIMPACK_FACTORY_PLAYER_REF);
        game.dispatchMessage(new ConfigureTradingTerminalMessage(node.objectRef, MARKET_MODE_BUY, node.itemTypeId, node.price), session);
        return;
    }
    for (const edge of node.children) {
        configureTerminals(game, edge.child);
    }
}

/**
 * The waypoint tiles of a belt/pipe path from `from` (a producer's own output-landing tile) to
 * `to` (the tile immediately south of a consumer's input port), inclusive. Both ends must face UP,
 * matching the fixed travel direction every port in this game declares (see
 * project_pipe_port_geometry): a belt/pipe only receives from a neighbor whose port resolves to the
 * SAME tile+direction key, so the head tile can't immediately turn — it has to climb north
 * (still UP-facing, directly off the producer) before any horizontal jog. Interior corners don't
 * have this restriction (consecutive belts merge into one path regardless of each tile's own
 * facing), so the shape is simply: climb `climb` tiles, jog horizontally to the target column,
 * climb the rest of the way.
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {number} climb tiles to climb (>=1) before any horizontal jog
 * @returns {{x: number, y: number}[]}
 */
function pathWaypoints(from, to, climb) {
    const waypoints = [];
    let x = from.x;
    let y = from.y;
    if (x !== to.x) {
        while (y > from.y - climb) {
            waypoints.push({x, y});
            y -= 1;
        }
        const dx = Math.sign(to.x - x);
        while (x !== to.x) {
            waypoints.push({x, y});
            x += dx;
        }
    }
    while (y !== to.y) {
        waypoints.push({x, y});
        y -= 1;
    }
    waypoints.push({x: to.x, y: to.y});
    return waypoints;
}

/**
 * Lays a belt/pipe path from `from` to `to` (see pathWaypoints), picking the smallest climb depth
 * (1, 2, 3, ...) whose full waypoint list doesn't step on any tile `occupied` already claims.
 * Reserves every tile it uses in `occupied` before placing, so later edges see it as reserved.
 * @param {GameEngine} engine
 * @param {ObjectType} objectType BeltType or PipeType
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {Set<string>} occupied
 * @returns {void}
 */
function layPath(engine, objectType, from, to, occupied) {
    // A climb past the target row can never turn back south, so the gap itself bounds the search.
    const maxClimb = from.y - to.y;
    let waypoints = null;
    for (let climb = 1; climb <= maxClimb; climb += 1) {
        const candidate = pathWaypoints(from, to, climb);
        const free = candidate.every(tile => !occupied.has(tileKeyAt(tile.x, tile.y)));
        if (free) {
            waypoints = candidate;
            break;
        }
    }
    if (waypoints === null) {
        throw new Error(`No collision-free path found from (${from.x},${from.y}) to (${to.x},${to.y})`);
    }
    for (const tile of waypoints) {
        occupied.add(tileKeyAt(tile.x, tile.y));
    }
    for (let i = 0; i < waypoints.length; i += 1) {
        const cur = waypoints[i];
        const next = waypoints[i + 1];
        let direction = Direction.UP;
        if (next !== undefined) {
            if (next.x > cur.x) {
                direction = Direction.RIGHT;
            } else if (next.x < cur.x) {
                direction = Direction.LEFT;
            }
        }
        engine.applyMessage(new CreateObjectMessage(objectType.objectTypeId, cur.x, cur.y, direction));
    }
}

/**
 * Wires every parent-child edge: a belt (solid) or pipe (fluid) path from the child's own output
 * tile to the tile immediately south of the parent's specific input port — connector kind is read
 * off the parent's own port declaration, never guessed.
 * @param {GameEngine} engine
 * @param {object} node
 * @param {Set<string>} occupied
 * @returns {void}
 */
function connectEdges(engine, node, occupied) {
    const parentType = placedType(node);
    for (const edge of node.children) {
        const child = edge.child;
        const inputPort = parentType.inputPorts[edge.portIndex];
        const inTile = {x: node.x + inputPort.x, y: node.y + inputPort.y};
        const connectorTile = {x: inTile.x, y: inTile.y + 1};
        const outputPort = placedType(child).outputPorts[0];
        const outTile = {x: child.x + outputPort.x, y: child.y + outputPort.y};
        const objectType = inputPort.fluid ? PipeType : BeltType;
        layPath(engine, objectType, outTile, connectorTile, occupied);
        connectEdges(engine, child, occupied);
    }
}

/**
 * Builds the whole Stimpack production chain at (originX, originY) (Fill's own anchor), pre-funds
 * and pre-claims the chunks it occupies for STIMPACK_FACTORY_PLAYER_REF, and returns the root node
 * (whose `.type`/`.x`/`.y` locate the final Fill machine, for a caller that wants to follow its
 * output port).
 * @param {GameEngine} engine
 * @param {Game} game
 * @param {number} originX
 * @param {number} originY
 * @returns {object} the root (Fill) node
 */
export function buildStimpackFactory(engine, game, originX, originY) {
    const tree = layoutTree();

    // Claimed before anything is placed: production is attributed to the chunk's current owner, so
    // objects standing on unclaimed ground count for nobody. The row north of the origin carries
    // Fill's own output.
    const minChunkX = Math.floor(originX / CHUNK_SIZE);
    const maxChunkX = Math.floor((originX + FACTORY_WIDTH - 1) / CHUNK_SIZE);
    const minChunkY = Math.floor((originY - 1) / CHUNK_SIZE);
    const maxChunkY = Math.floor((originY + FACTORY_HEIGHT - 1) / CHUNK_SIZE);
    const owned = game.claims.getChunkKeysByPlayerRef(STIMPACK_FACTORY_PLAYER_REF).size;
    const maxChunks = owned + (maxChunkX - minChunkX + 1) * (maxChunkY - minChunkY + 1);
    for (let cy = minChunkY; cy <= maxChunkY; cy += 1) {
        for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
            game.claims.claim(STIMPACK_FACTORY_PLAYER_REF, chunkOrdinal(cx, cy), maxChunks);
        }
    }
    let balance = game.playerSettings.getPlayerValueByKey(STIMPACK_FACTORY_PLAYER_REF, MARKET_SETTING_BALANCE);
    if (balance === undefined) {
        balance = 0;
    }
    game.playerSettings.setPlayerValue(STIMPACK_FACTORY_PLAYER_REF, MARKET_SETTING_BALANCE, balance + STARTING_BALANCE);

    const occupied = new Set();
    placeNode(engine, tree, originX, originY, occupied);
    connectEdges(engine, tree, occupied);
    configureTerminals(game, tree);

    return tree;
}

/**
 * @param {object} node
 * @param {Function} select
 * @returns {number}
 */
function maxOf(node, select) {
    let best = select(node);
    for (const edge of node.children) {
        best = Math.max(best, maxOf(edge.child, select));
    }
    return best;
}

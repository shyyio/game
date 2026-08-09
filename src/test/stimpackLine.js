// Builds the full production chain, end to end, as a real placed factory
// (extractors, machines, belts, pipes, Trading Terminals) — not scripted item-shuttling. Every
// producer instance feeds exactly one consumer port (a tree, never a shared fan-out network), so
// placement uses a simple tree layout: each leaf gets its own horizontal lane, each internal node
// inherits its leftmost child's lane, and depth-from-root sets the row (root/Fill north, leaves
// south, matching this game's north-flowing port convention — see project_pipe_port_geometry).

import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {Direction} from "@/common/constants.js";
import {chunkOrdinal} from "@/common/util.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {PipeDefinition} from "@/mods/Fluids/common/objectTypes.js";
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
} from "@/mods/BaseGame/common/objectTypes.js";
import {
    ITEM_TYPE_SOYBEAN_SEEDS,
    ITEM_TYPE_MUSHROOM_SPORE,
    NPC_PRICE_SOYBEAN_SEEDS,
    NPC_PRICE_MUSHROOM_SPORE,
} from "@/mods/BaseGame/common/constants.js";
import {TradingTerminalType} from "@/mods/Market/common/objectTypes.js";
import {ConfigureTradingTerminalMessage} from "@/mods/Market/common/messages.js";
import {MARKET_MODE_BUY, MARKET_SETTING_BALANCE} from "@/mods/Market/common/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";

// Tile spacing between sibling leaf lanes / between depth tiers: generous relative to the largest
// footprint (3x3) and the ports' own column spread (0-2), so unrelated branches never collide.
const LANE_WIDTH = 11;
const TIER_HEIGHT = 8;

// The player this factory is built for: pre-funded and pre-claimed, so its two NPC-buy Trading
// Terminals are live from tick one (no session needs to claim/configure anything by hand).
export const STIMPACK_FACTORY_PLAYER_ID = 1;
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
 * @param {number} itemType
 * @param {number} price
 * @returns {object}
 */
function terminalLeaf(itemType, price) {
    return {kind: "terminal", name: "TradingTerminal", itemType, price, children: []};
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
                            {portIndex: 0, child: terminalLeaf(ITEM_TYPE_SOYBEAN_SEEDS, NPC_PRICE_SOYBEAN_SEEDS)},
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
 * @param {object} node
 * @param {number} depth root (Fill) is 0; leaves are deepest
 * @returns {void}
 */
function assignDepth(node, depth) {
    node.depth = depth;
    for (const edge of node.children) {
        assignDepth(edge.child, depth + 1);
    }
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
function tileKey(x, y) {
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
            occupied.add(tileKey(x + dx, y + dy));
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
    node.y = originY + node.depth * TIER_HEIGHT;
    if (node.kind === "resource") {
        engine.applyMessage(new CreateObjectMessage(node.resourceType.typeId, node.x, node.y, Direction.UP));
        engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, node.x, node.y, Direction.UP));
        node.outputPort = ExtractorType.outputPorts[0];
        markFootprint(occupied, ExtractorType, node.x, node.y);
    } else if (node.kind === "terminal") {
        engine.applyMessage(new CreateObjectMessage(TradingTerminalType.typeId, node.x, node.y, Direction.UP));
        const eid = engine.placed.eidsOf(TradingTerminalType.typeId).at(-1);
        node.objectId = engine.placed.objectIdOf(eid);
        node.outputPort = TradingTerminalType.outputPorts[0];
        markFootprint(occupied, TradingTerminalType, node.x, node.y);
    } else {
        engine.applyMessage(new CreateObjectMessage(node.type.typeId, node.x, node.y, Direction.UP));
        node.outputPort = node.type.outputPorts[0];
        markFootprint(occupied, node.type, node.x, node.y);
    }
    for (const edge of node.children) {
        placeNode(engine, edge.child, originX, originY, occupied);
    }
}

/**
 * Configures every Trading Terminal leaf to buy its NPC-priced item, using the objectId placeNode
 * captured for it directly — never re-queried after the fact, since by the time every terminal is
 * placed there's no way to tell them apart by "the last one created".
 * @param {Game} game
 * @param {object} node
 * @returns {void}
 */
function configureTerminals(game, node) {
    if (node.kind === "terminal") {
        const session = new CapturingSession(STIMPACK_FACTORY_PLAYER_ID);
        game.dispatchMessage(new ConfigureTradingTerminalMessage(node.objectId, MARKET_MODE_BUY, node.itemType, node.price), session);
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

// How many distinct climb depths to try before giving up on a collision-free path for one edge.
const MAX_CLIMB_ATTEMPTS = 40;

/**
 * Lays a belt/pipe path from `from` to `to` (see pathWaypoints), picking the smallest climb depth
 * (1, 2, 3, ...) whose full waypoint list doesn't step on any tile `occupied` already claims —
 * a fixed/staggered climb isn't enough on its own: a producer's own climb column can coincide with
 * some unrelated edge's target column purely by lane-assignment coincidence (happened for real
 * between Brew's two same-depth inputs), so this searches instead of guessing. Reserves every tile
 * it uses in `occupied` before placing, so later edges see it as reserved.
 * @param {GameEngine} engine
 * @param {Function} Definition BeltDefinition or PipeDefinition
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {Set<string>} occupied
 * @returns {void}
 */
function layPath(engine, Definition, from, to, occupied) {
    let waypoints = null;
    for (let climb = 1; climb <= MAX_CLIMB_ATTEMPTS; climb += 1) {
        const candidate = pathWaypoints(from, to, climb);
        const free = candidate.every(tile => !occupied.has(tileKey(tile.x, tile.y)));
        if (free) {
            waypoints = candidate;
            break;
        }
    }
    if (waypoints === null) {
        throw new Error(`No collision-free path found from (${from.x},${from.y}) to (${to.x},${to.y})`);
    }
    for (const tile of waypoints) {
        occupied.add(tileKey(tile.x, tile.y));
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
        engine.applyMessage(new CreateObjectMessage(Definition.typeId, cur.x, cur.y, direction));
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
    const parentType = node.kind === "terminal" ? TradingTerminalType : node.type;
    for (const edge of node.children) {
        const child = edge.child;
        const inPort = parentType.inputPorts[edge.portIndex];
        const inTile = {x: node.x + inPort.x, y: node.y + inPort.y};
        const connectorTile = {x: inTile.x, y: inTile.y + 1};
        const outTile = {x: child.x + child.outputPort.x, y: child.y + child.outputPort.y};
        const Definition = inPort.fluid ? PipeDefinition : BeltDefinition;
        layPath(engine, Definition, outTile, connectorTile, occupied);
        connectEdges(engine, child, occupied);
    }
}

/**
 * Builds the whole Stimpack production chain at (originX, originY) (Fill's own anchor), pre-funds
 * and pre-claims the chunks it occupies for STIMPACK_FACTORY_PLAYER_ID, and returns the root node
 * (whose `.type`/`.x`/`.y` locate the final Fill machine, for a caller that wants to watch its
 * output port).
 * @param {GameEngine} engine
 * @param {Game} game
 * @param {number} originX
 * @param {number} originY
 * @returns {object} the root (Fill) node
 */
export function buildStimpackFactory(engine, game, originX, originY) {
    const tree = buildTree();
    assignLanes(tree, {next: 0});
    assignDepth(tree, 0);

    // Claimed before anything is placed: PlacedObject.ownerId is cached from the chunk's owner at
    // spawn time, so a claim arriving afterward would leave every object attributed to nobody.
    let leafCount = 0;
    countLeaves(tree, {count: () => { leafCount += 1; }});
    const maxDepth = maxOf(tree, node => node.depth);
    const minX = originX - 5;
    const maxX = originX + leafCount * LANE_WIDTH + 5;
    const minY = originY - 5;
    const maxY = originY + (maxDepth + 1) * TIER_HEIGHT + 5;
    const minChunkX = Math.floor(minX / CHUNK_SIZE);
    const maxChunkX = Math.floor(maxX / CHUNK_SIZE);
    const minChunkY = Math.floor(minY / CHUNK_SIZE);
    const maxChunkY = Math.floor(maxY / CHUNK_SIZE);
    const maxChunks = (maxChunkX - minChunkX + 1) * (maxChunkY - minChunkY + 1);
    for (let cy = minChunkY; cy <= maxChunkY; cy += 1) {
        for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
            game.claims.claim(STIMPACK_FACTORY_PLAYER_ID, chunkOrdinal(cx, cy), maxChunks);
        }
    }
    game.playerSettings.set(STIMPACK_FACTORY_PLAYER_ID, MARKET_SETTING_BALANCE, STARTING_BALANCE);

    const occupied = new Set();
    placeNode(engine, tree, originX, originY, occupied);
    connectEdges(engine, tree, occupied);
    configureTerminals(game, tree);

    return tree;
}

/**
 * @param {object} node
 * @param {{count: Function}} sink
 * @returns {void}
 */
function countLeaves(node, sink) {
    if (node.children.length === 0) {
        sink.count();
        return;
    }
    for (const edge of node.children) {
        countLeaves(edge.child, sink);
    }
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

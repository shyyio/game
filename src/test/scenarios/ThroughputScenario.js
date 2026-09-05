// A throughput probe, not game content: a Trading Terminal buying from the NPC feeds two 0-tick
// machines in series, ending in a Sink that drains whatever reaches it. Every stage is 1x1 and sits
// in one column, with `belts` (tiles of belt between stages) the main variable: 0 wires each
// stage's output port straight into the next stage's input port, which is the same port entity, and
// the belt-less variant falls out of the same layout code. When the Press->Pack run has room
// (belts >= 2), a Splitter replaces its second belt tile and routes out_b onto a mirror column one
// tile east: its own belts, machine, and Sink, so the splitter itself sits under throughput load.
// The whole chain is tiled `n` times in a near-square grid, one tile of gap between copies.
//
// The object types below are a scenario-local mod, injected into the loadout only when this
// scenario is selected (see modPackages) — nothing here is real game content, so none of it belongs
// under src/mods/.

import {
    AbstractModDeclaration,
    AbstractBehavior,
    ModPackage,
    ObjectType,
    PortDefinition,
    RecipeDefinition,
    PlacementRule,
    MachineBehavior,
    ItemDefinition,
    ItemCategory,
    MarketListingEntry,
    Direction,
    TickPhase,
    EMPTY,
    NO_EID,
    CHUNK_SIZE,
} from "@/sdk/common.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {chunkOrdinal} from "@/common/util.js";
import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {BeltDefinition, SplitterDefinition} from "@/mods/logistics/common/objectTypes.js";
import {TradingTerminalType} from "@/mods/market/common/objectTypes.js";
import {ConfigureTradingTerminalMessage} from "@/mods/market/common/messages.js";
import {MARKET_MODE_BUY, MARKET_SETTING_BALANCE} from "@/mods/market/common/constants.js";

// Own item range, clear of BaseGame's 3xx and the engine fixtures' 94x.
export const ITEM_TYPE_THROUGHPUT_FEED = 950;
export const ITEM_TYPE_THROUGHPUT_PART = 951;
export const ITEM_TYPE_THROUGHPUT_UNIT = 952;

// Feed is bought one per tick for the whole run, so keep it cheap against the granted balance.
export const NPC_PRICE_THROUGHPUT_FEED = 1;

const IN = new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP});
const OUT = new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP});

/**
 * A 1x1, single-recipe machine crafting in 0 ticks, so a fed line runs at full throughput.
 * @param {string} name
 * @param {string} label
 * @param {number} toolId
 * @param {number} input
 * @param {number} output
 * @returns {ObjectType}
 */
function press(name, label, toolId, input, output) {
    return new ObjectType({
        name,
        toolId,
        inputPorts: [IN],
        outputPorts: [OUT],
        geometry: "1x1",
        renderConnections: true,
        textureName: "demo-machine/0",
        label,
        inspectable: true,
        placement: new PlacementRule({replaceSameKind: true}),
        behavior: new MachineBehavior({
            processingTicks: 0,
            recipes: [new RecipeDefinition([input], output)],
            fallback: ITEM_TYPE_THROUGHPUT_UNIT,
        }),
    });
}

/**
 * A bottomless consumer: drains its input port every tick and counts what it took, so a run's
 * delivered total is one component column read (see {@link sinkConsumedTotal}).
 */
class SinkBehavior extends AbstractBehavior {

    /**
     * @param {GameEngine} engine
     * @returns {void}
     */
    install(engine) {
        engine.components.define("ThroughputSink", [
            {name: "in", kind: "eid", fill: NO_EID},
            {name: "consumed"},
            {name: "lastConsumed", fill: EMPTY},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => SinkBehavior._submitIntents(engine));
    }

    /**
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {ObjectType} type
     * @param {CreateObjectMessage} message
     * @returns {void}
     */
    onSpawn(engine, eid, type, message) {
        const def = engine.components.get("ThroughputSink");
        engine.components.attach(def, eid);
        const row = def.row(eid);
        def.store.in[row] = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction).port;
    }

    /**
     * SUBMIT_INTENTS: drains whatever rests in the input port. A managed drain has no counterpart to
     * lose arbitration to, so the count is booked here rather than in a POST_RESOLVE pass.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const item = engine.Port.item;
        const def = engine.components.get("ThroughputSink");
        const sink = def.store;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            const inPort = sink.in[row];
            if (item[inPort] === EMPTY) {
                continue;
            }
            sink.lastConsumed[row] = item[inPort];
            sink.consumed[row] += 1;
            engine.transfers.submitDrain(inPort, true);
        }
    }
}

export const ThroughputPressType = press(
    "ThroughputPress", "Throughput Press", 90, ITEM_TYPE_THROUGHPUT_FEED, ITEM_TYPE_THROUGHPUT_PART,
);

export const ThroughputPackType = press(
    "ThroughputPack", "Throughput Pack", 91, ITEM_TYPE_THROUGHPUT_PART, ITEM_TYPE_THROUGHPUT_UNIT,
);

export const ThroughputSinkType = new ObjectType({
    name: "ThroughputSink",
    toolId: 92,
    inputPorts: [IN],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Throughput Sink",
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new SinkBehavior(),
});

export class ThroughputDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "Throughput";
    }

    get objectTypes() {
        return [ThroughputPressType, ThroughputPackType, ThroughputSinkType];
    }

    get items() {
        return [new ItemCategory("Throughput", {
            [ITEM_TYPE_THROUGHPUT_FEED]: new ItemDefinition("Throughput Feed", "items/2-gray", 0xE0C878),
            [ITEM_TYPE_THROUGHPUT_PART]: new ItemDefinition("Throughput Part", "items/1-gray", 0xB0B8C0),
            [ITEM_TYPE_THROUGHPUT_UNIT]: new ItemDefinition("Throughput Unit", "items/4-gray", 0x8FBF5A),
        })];
    }

    get marketListings() {
        return [new MarketListingEntry(ITEM_TYPE_THROUGHPUT_FEED, NPC_PRICE_THROUGHPUT_FEED)];
    }
}

// The chain's south end; it runs north from here, matching the north-flowing port convention.
const ORIGIN_X = 8;
const ORIGIN_Y = 24;

// Belt tiles between consecutive stages; 0 is the belt-less variant.
const DEFAULT_BELT_LENGTH = 4;
const BELT_LENGTH_PARAM = "belts";

// Chain copies tiled in a near-square grid, separated by one empty tile.
const DEFAULT_COPY_COUNT = 100;
const COPY_COUNT_PARAM = "n";
const COPY_GAP = 1;

// Long enough for the longest default chain to fill and settle into its steady rate.
const WARMUP_TICKS = 120;

// The player the chains are built for: pre-claimed and pre-funded, so the buy terminals are live
// from tick one (a terminal on an unclaimed chunk caches a 0 balance and never buys).
export const THROUGHPUT_PLAYER_ID = 1;

// Runway per chain copy; the granted balance scales with `n`.
const STARTING_BALANCE_PER_COPY = 1000000;

/**
 * Parses a non-negative integer query param, falling back when absent or unparsable.
 * @param {string|null} raw
 * @param {number} fallback
 * @returns {number}
 */
function intParam(raw, fallback) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return fallback;
}

/**
 * The total items every Sink in the world has drained.
 * @param {GameEngine} engine
 * @returns {number}
 */
export function sinkConsumedTotal(engine) {
    const def = engine.components.get("ThroughputSink");
    const consumed = def.store.consumed;
    let total = 0;
    for (let row = 0; row < def.count; row += 1) {
        total += consumed[row];
    }
    return total;
}

/**
 * Claims every chunk the tiled grid touches, before anything is placed: PlacedObject.ownerId is
 * cached from the chunk's owner at spawn time, so a later claim would leave terminals ownerless.
 * Row-major order keeps every claim adjacent to an owned chunk.
 * @param {Game} game
 * @param {number} minX
 * @param {number} maxX
 * @param {number} minY
 * @param {number} maxY
 * @returns {void}
 */
function claimRect(game, minX, maxX, minY, maxY) {
    const minChunkX = Math.floor(minX / CHUNK_SIZE);
    const maxChunkX = Math.floor(maxX / CHUNK_SIZE);
    const minChunkY = Math.floor(minY / CHUNK_SIZE);
    const maxChunkY = Math.floor(maxY / CHUNK_SIZE);
    const maxChunks = (maxChunkX - minChunkX + 1) * (maxChunkY - minChunkY + 1);
    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
        for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
            game.claims.claim(THROUGHPUT_PLAYER_ID, chunkOrdinal(chunkX, chunkY), maxChunks);
        }
    }
}

/**
 * Builds one terminal -> press -> [splitter] -> pack -> sink chain running north from its origin.
 * @param {GameEngine} engine
 * @param {number} originX
 * @param {number} originY
 * @param {number} beltLength
 * @returns {void}
 */
function buildChain(engine, originX, originY, beltLength) {
    const stride = beltLength + 1;
    const pressY = originY - stride;
    const packY = originY - 2 * stride;
    const sinkY = originY - 3 * stride;
    const splitterFits = beltLength >= 2;

    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.typeId, originX, originY, Direction.UP));
    layBelts(engine, originX, originY, beltLength);
    engine.applyMessage(new CreateObjectMessage(ThroughputPressType.typeId, originX, pressY, Direction.UP));
    if (splitterFits) {
        layBelts(engine, originX, pressY, 1);
        engine.applyMessage(new CreateObjectMessage(SplitterDefinition.typeId, originX, pressY - 2, Direction.UP));
        layBelts(engine, originX, pressY - 2, beltLength - 2);
    } else {
        layBelts(engine, originX, pressY, beltLength);
    }
    engine.applyMessage(new CreateObjectMessage(ThroughputPackType.typeId, originX, packY, Direction.UP));
    layBelts(engine, originX, packY, beltLength);
    engine.applyMessage(new CreateObjectMessage(ThroughputSinkType.typeId, originX, sinkY, Direction.UP));

    if (splitterFits) {
        // Splitter out_b lands here; a second Press fed parts crafts its fallback unit.
        const branchX = originX + 1;
        layBelts(engine, branchX, pressY - 2, beltLength - 2);
        engine.applyMessage(new CreateObjectMessage(ThroughputPressType.typeId, branchX, packY, Direction.UP));
        layBelts(engine, branchX, packY, beltLength);
        engine.applyMessage(new CreateObjectMessage(ThroughputSinkType.typeId, branchX, sinkY, Direction.UP));
    }
}

/**
 * Lays the belt run connecting the stage at `fromY` to the stage at `fromY - stride`: it starts on
 * the producer's own output-landing tile (one north of it) and ends on the tile immediately south of
 * the consumer's input port. A zero-length run leaves the two stages sharing one port entity.
 * @param {GameEngine} engine
 * @param {number} x
 * @param {number} fromY
 * @param {number} beltLength
 * @returns {void}
 */
function layBelts(engine, x, fromY, beltLength) {
    for (let step = 1; step <= beltLength; step += 1) {
        engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, x, fromY - step, Direction.UP));
    }
}

/**
 * Trade terminal -> two 0-tick machines in series -> sink, with `belts` belt tiles between stages
 * and, when it fits, a Splitter after the Press feeding a mirror column of machine and sink.
 * `n` copies of the chain tile a near-square rectangle.
 */
export class ThroughputScenario extends AbstractScenario {

    /**
     * @returns {string}
     */
    get name() {
        return "throughput";
    }

    /**
     * @returns {ModPackage[]}
     */
    modPackages() {
        return [new ModPackage(new ThroughputDeclaration())];
    }

    /**
     * @param {Game} game
     * @param {URLSearchParams} params
     * @returns {Promise<void>}
     */
    async apply(game, params) {
        const beltLength = intParam(params.get(BELT_LENGTH_PARAM), DEFAULT_BELT_LENGTH);
        const copies = Math.max(1, intParam(params.get(COPY_COUNT_PARAM), DEFAULT_COPY_COUNT));
        const stride = beltLength + 1;
        const engine = game.simEngine;

        const columns = Math.ceil(Math.sqrt(copies));
        const rows = Math.ceil(copies / columns);
        const copyWidth = beltLength >= 2 ? 2 : 1;
        const pitchX = copyWidth + COPY_GAP;
        const pitchY = 3 * stride + 1 + COPY_GAP;
        claimRect(
            game,
            ORIGIN_X, ORIGIN_X + (columns - 1) * pitchX + copyWidth - 1,
            ORIGIN_Y - 3 * stride, ORIGIN_Y + (rows - 1) * pitchY,
        );
        game.playerSettings.set(THROUGHPUT_PLAYER_ID, MARKET_SETTING_BALANCE, STARTING_BALANCE_PER_COPY * copies);

        for (let copy = 0; copy < copies; copy += 1) {
            const originX = ORIGIN_X + (copy % columns) * pitchX;
            const originY = ORIGIN_Y + Math.floor(copy / columns) * pitchY;
            buildChain(engine, originX, originY, beltLength);
        }

        const session = new CapturingSession(THROUGHPUT_PLAYER_ID);
        for (const terminalEid of engine.placed.eidsOf(TradingTerminalType.typeId)) {
            game.dispatchMessage(new ConfigureTradingTerminalMessage(
                engine.placed.objectIdOf(terminalEid), MARKET_MODE_BUY,
                ITEM_TYPE_THROUGHPUT_FEED, NPC_PRICE_THROUGHPUT_FEED,
            ), session);
        }

        for (let tick = 0; tick < WARMUP_TICKS; tick += 1) {
            game.runTick();
        }
    }
}

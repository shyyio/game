// A throughput probe, not game content: a Trading Terminal buying from the NPC feeds two 1-tick
// machines in series, ending in a Sink that drains whatever reaches it. Every stage is 1x1 and sits
// in one column, so `belts` (tiles of belt between stages) is the only variable: 0 wires each
// stage's output port straight into the next stage's input port, which is the same port entity, and
// the belt-less variant falls out of the same layout code.
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
import {BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {TradingTerminalType} from "@/mods/Market/common/objectTypes.js";
import {ConfigureTradingTerminalMessage} from "@/mods/Market/common/messages.js";
import {MARKET_MODE_BUY, MARKET_SETTING_BALANCE} from "@/mods/Market/common/constants.js";

// Own item range, clear of BaseGame's 3xx and the engine fixtures' 94x.
export const ITEM_TYPE_THROUGHPUT_FEED = 950;
export const ITEM_TYPE_THROUGHPUT_PART = 951;
export const ITEM_TYPE_THROUGHPUT_UNIT = 952;

// Feed is bought one per tick for the whole run, so keep it cheap against the granted balance.
export const NPC_PRICE_THROUGHPUT_FEED = 1;

const IN = new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP});
const OUT = new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP});

/**
 * A 1x1, single-recipe, 1-tick machine.
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
            processingTicks: 1,
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
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    install(engine, placed) {
        engine.defineComponent("ThroughputSink", [
            {name: "in", kind: "eid", fill: NO_EID},
            {name: "consumed"},
            {name: "lastConsumed", fill: EMPTY},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => SinkBehavior._submitIntents(engine));
    }

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @param {ObjectType} type
     * @param {CreateObjectMessage} message
     * @returns {void}
     */
    onSpawn(engine, placed, eid, type, message) {
        const def = engine.component("ThroughputSink");
        engine.attachComponent(def, eid);
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
        const def = engine.component("ThroughputSink");
        const sink = def.store;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            const inPort = sink.in[row];
            if (item[inPort] === EMPTY) {
                continue;
            }
            sink.lastConsumed[row] = item[inPort];
            sink.consumed[row] += 1;
            engine.submitDrain(inPort, true);
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
        return {
            [ITEM_TYPE_THROUGHPUT_FEED]: new ItemDefinition("Throughput Feed", "items/2-gray", 0xE0C878),
            [ITEM_TYPE_THROUGHPUT_PART]: new ItemDefinition("Throughput Part", "items/1-gray", 0xB0B8C0),
            [ITEM_TYPE_THROUGHPUT_UNIT]: new ItemDefinition("Throughput Unit", "items/4-gray", 0x8FBF5A),
        };
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

// Long enough for the longest default chain to fill and settle into its steady rate.
const WARMUP_TICKS = 120;

// The player the chain is built for: pre-claimed and pre-funded, so the buy terminal is live from
// tick one (a terminal on an unclaimed chunk caches a 0 balance and never buys).
export const THROUGHPUT_PLAYER_ID = 1;
const STARTING_BALANCE = 1000000;

// Stages, south to north; the terminal at ORIGIN_Y is stage 0.
const STAGE_COUNT = 4;

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
    const def = engine.component("ThroughputSink");
    const consumed = def.store.consumed;
    let total = 0;
    for (let row = 0; row < def.count; row += 1) {
        total += consumed[row];
    }
    return total;
}

/**
 * Claims every chunk the chain touches, before anything is placed: PlacedObject.ownerId is cached
 * from the chunk's owner at spawn time, so a later claim would leave the terminal ownerless.
 * @param {Game} game
 * @param {number} northY the chain's northernmost tile
 * @returns {void}
 */
function claimColumn(game, northY) {
    const chunkX = Math.floor(ORIGIN_X / CHUNK_SIZE);
    const minChunkY = Math.floor(northY / CHUNK_SIZE);
    const maxChunkY = Math.floor(ORIGIN_Y / CHUNK_SIZE);
    const maxChunks = maxChunkY - minChunkY + 1;
    for (let chunkY = maxChunkY; chunkY >= minChunkY; chunkY -= 1) {
        game.claims.claim(THROUGHPUT_PLAYER_ID, chunkOrdinal(chunkX, chunkY), maxChunks);
    }
}

/**
 * Lays the belt run connecting the stage at `fromY` to the stage at `fromY - stride`: it starts on
 * the producer's own output-landing tile (one north of it) and ends on the tile immediately south of
 * the consumer's input port. A zero-length run leaves the two stages sharing one port entity.
 * @param {GameEngine} engine
 * @param {number} fromY
 * @param {number} beltLength
 * @returns {void}
 */
function layBelts(engine, fromY, beltLength) {
    for (let step = 1; step <= beltLength; step += 1) {
        engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, ORIGIN_X, fromY - step, Direction.UP));
    }
}

/**
 * Trade terminal -> two 1-tick machines in series -> sink, with `belts` belt tiles between stages.
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
        const stride = beltLength + 1;
        const engine = game.simEngine;
        claimColumn(game, ORIGIN_Y - (STAGE_COUNT - 1) * stride);
        game.playerSettings.set(THROUGHPUT_PLAYER_ID, MARKET_SETTING_BALANCE, STARTING_BALANCE);

        const stages = [TradingTerminalType, ThroughputPressType, ThroughputPackType, ThroughputSinkType];
        for (const [index, type] of stages.entries()) {
            const y = ORIGIN_Y - index * stride;
            engine.applyMessage(new CreateObjectMessage(type.typeId, ORIGIN_X, y, Direction.UP));
            if (index < stages.length - 1) {
                layBelts(engine, y, beltLength);
            }
        }

        const terminalEid = engine.placed.eidsOf(TradingTerminalType.typeId).at(-1);
        const session = new CapturingSession(THROUGHPUT_PLAYER_ID);
        game.dispatchMessage(new ConfigureTradingTerminalMessage(
            engine.placed.objectIdOf(terminalEid), MARKET_MODE_BUY,
            ITEM_TYPE_THROUGHPUT_FEED, NPC_PRICE_THROUGHPUT_FEED,
        ), session);

        for (let tick = 0; tick < WARMUP_TICKS; tick += 1) {
            game.runTick();
        }
    }
}

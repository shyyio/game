// The bottomless consumer every throughput-shaped scenario ends in: it drains its input port every
// tick, so the run ahead of it never backs up. Scenario-local, so it registers only with the
// scenario mod that declares it.

import {
    AbstractBehavior,
    AbstractSystem,
    AbstractComponent,
    FieldDefinition,
    ObjectType,
    PortDefinition,
    PlacementRule,
    Direction,
    EMPTY,
    NO_EID,
} from "@/sdk/common.js";

const SINK_COMPONENT = "ScenarioSink";

/**
 * A scenario sink: the input port it drains, and what it took.
 */
class ScenarioSinkComponent extends AbstractComponent {

    constructor() {
        super(SINK_COMPONENT, [
            new FieldDefinition("inputPort", "eid", NO_EID),
            new FieldDefinition("consumed"),
            new FieldDefinition("lastConsumed", "i32", EMPTY),
        ], {isSparse: true});
    }
}

/**
 * Ticks every sink.
 */
class SinkSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;
    }

    submitIntents() {
        SinkBehavior._submitIntents(this.engine);
    }
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
        engine.components.register(new ScenarioSinkComponent());
        engine.registerSystem(new SinkSystem(engine));
    }

    /**
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {ObjectType} type
     * @param {CreateObjectMessage} message
     * @returns {void}
     */
    onSpawn(engine, eid, type, message) {
        const sinks = engine.components.getComponentByName(SINK_COMPONENT);
        sinks.attach(eid);
        const row = sinks.getRowByEid(eid);
        sinks.store.inputPort[row] = engine.getPortAt(type.inputPorts[0], message.x, message.y, message.direction).port;
    }

    /**
     * SUBMIT_INTENTS: drains whatever rests in the input port. A drain resolves outright, so the
     * count is booked here.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const item = engine.Port.item;
        const sinks = engine.components.getComponentByName(SINK_COMPONENT);
        const sink = sinks.store;
        const count = sinks.count;
        for (let row = 0; row < count; row += 1) {
            const inputPort = sink.inputPort[row];
            if (item[inputPort] === EMPTY) {
                continue;
            }
            sink.lastConsumed[row] = item[inputPort];
            sink.consumed[row] += 1;
            engine.transfers.submitDrain(inputPort);
        }
    }
}

export const SINK_INPUT_PORT = new PortDefinition("inputPort", {x: 0, y: 0, direction: Direction.UP});

export const ScenarioSinkType = new ObjectType({
    name: SINK_COMPONENT,
    toolId: 92,
    inputPorts: [SINK_INPUT_PORT],
    geometry: "1x1",
    textureName: "machine/1x1",
    label: "Scenario Sink",
    placement: new PlacementRule({shouldReplaceSameKind: true}),
    behavior: new SinkBehavior(),
});

/**
 * The total items every sink in the world has drained.
 * @param {GameEngine} engine
 * @returns {number}
 */
export function sinkConsumedTotal(engine) {
    const sinks = engine.components.getComponentByName(SINK_COMPONENT);
    const consumed = sinks.store.consumed;
    let total = 0;
    for (let row = 0; row < sinks.count; row += 1) {
        total += consumed[row];
    }
    return total;
}

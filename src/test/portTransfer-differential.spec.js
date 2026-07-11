import {test} from "node:test";
import assert from "node:assert/strict";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {SqlEngine} from "@/test/SqlEngine.js";

// Differential parity: each scenario builds an identical port/intent setup on a fresh engine and
// returns the port ids to inspect. The harness resolves, reads the resolved edges, commits, reads
// the resulting port items — then asserts the bitECS EcsEngine and the legacy SqlEngine agree.
// Both allocate port ids 1, 2, 3, ... in creation order, so ids line up across engines.
const scenarios = [
    {
        name: "packed chain shifts as one when the end drains",
        build(engine) {
            const p = [engine.addPort(1), engine.addPort(1), engine.addPort(1), engine.addPort()];
            engine.submitIntent({source: p[0], dest: p[1], destEmpty: false});
            engine.submitIntent({source: p[1], dest: p[2], destEmpty: false});
            engine.submitIntent({source: p[2], dest: p[3], destEmpty: true});
            return p;
        },
    },
    {
        name: "blocked chain resolves nothing",
        build(engine) {
            const p = [engine.addPort(1), engine.addPort(1), engine.addPort(1), engine.addPort(1)];
            engine.submitIntent({source: p[0], dest: p[1], destEmpty: false});
            engine.submitIntent({source: p[1], dest: p[2], destEmpty: false});
            engine.submitIntent({source: p[2], dest: p[3], destEmpty: false});
            return p;
        },
    },
    {
        name: "managed transfer translates item via output_item",
        build(engine) {
            const p = [engine.addPort(1), engine.addPort()];
            engine.submitIntent({source: p[0], dest: p[1], destEmpty: true, managed: true, outputItem: 99});
            return p;
        },
    },
    {
        name: "source-less managed intent creates an item",
        build(engine) {
            const p = [engine.addPort()];
            engine.submitIntent({source: EMPTY, dest: p[0], destEmpty: true, outputItem: 55, managed: true});
            return p;
        },
    },
    {
        name: "managed destination-less intent sinks the source",
        build(engine) {
            const p = [engine.addPort(1)];
            engine.submitIntent({source: p[0], dest: EMPTY, managed: true});
            return p;
        },
    },
    {
        name: "unmanaged self-drain leaves the source untouched",
        build(engine) {
            const p = [engine.addPort(1)];
            engine.submitIntent({source: p[0], dest: EMPTY, managed: false});
            return p;
        },
    },
    {
        name: "fan-out source keeps its best-ranked resolved destination",
        build(engine) {
            // One source competes for two empty destinations; the lower rank wins.
            const p = [engine.addPort(1), engine.addPort(), engine.addPort()];
            engine.submitIntent({source: p[0], dest: p[1], destEmpty: true, managed: true, rank: 2});
            engine.submitIntent({source: p[0], dest: p[2], destEmpty: true, managed: true, rank: 1});
            return p;
        },
    },
    {
        name: "contested destination goes to the lowest-ranked source",
        build(engine) {
            // Two sources want the same empty destination; the lower rank wins it.
            const p = [engine.addPort(1), engine.addPort(1), engine.addPort()];
            engine.submitIntent({source: p[0], dest: p[2], destEmpty: true, managed: true, rank: 2});
            engine.submitIntent({source: p[1], dest: p[2], destEmpty: true, managed: true, rank: 1});
            return p;
        },
    },
];

/**
 * Runs one scenario against a fresh engine and captures its observable output.
 * @param {Function} EngineClass
 * @param {object} scenario
 * @returns {Promise<{edges: string, items: number[]}>}
 */
async function observe(EngineClass, scenario) {
    const engine = new EngineClass();
    await engine.init();
    const ports = scenario.build(engine);
    engine.resolvePortTransfer();
    const edges = engine.resolvedEdges();
    engine.flushSinks();
    engine.commitTransfers();
    const items = ports.map(port => engine.portItem(port));
    return {edges, items};
}

scenarios.forEach(scenario => {
    test(`differential: ${scenario.name}`, async () => {
        const ecs = await observe(EcsEngine, scenario);
        const sql = await observe(SqlEngine, scenario);
        assert.deepEqual(ecs, sql, `EcsEngine ${JSON.stringify(ecs)} != SqlEngine ${JSON.stringify(sql)}`);
    });
});

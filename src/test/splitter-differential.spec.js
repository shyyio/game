import {test} from "node:test";
import assert from "node:assert/strict";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {SplitterModule} from "@/common/sim/SplitterSystems.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

// Uniform adapter over both engines: create a standalone splitter, poke ports, run whole ticks.
async function ecsAdapter() {
    const engine = new EcsEngine();
    await engine.init();
    const splitter = new SplitterModule(engine);
    return {
        addSplitter: () => splitter.addSplitter(),
        splitterState: (id) => splitter.state(id),
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        tickAll: () => engine.tickAll(),
    };
}

async function sqlAdapter() {
    // LogisticsMod registers the Splitter definition + the POST_RESOLVE seam ops.
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    return {
        addSplitter: () => engine.addSplitter(),
        splitterState: (id) => engine.splitterState(id),
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        tickAll: () => engine.tickAll(),
    };
}

// The whole observable splitter state: its six port items plus the round-robin bit.
function snapshot(adapter, s) {
    return {
        in_a: adapter.portItem(s.in_a), in_b: adapter.portItem(s.in_b),
        out_a: adapter.portItem(s.out_a), out_b: adapter.portItem(s.out_b),
        int_a: adapter.portItem(s.int_a), int_b: adapter.portItem(s.int_b),
        state: adapter.splitterState(s.id),
    };
}

// Each scenario is a list of steps run against a fresh splitter; a step mutates ports then ticks.
// The trace of post-step snapshots must match across the two engines.
const scenarios = [
    {
        name: "crosses in three ticks (input, internal, output) with no teleport",
        steps: [
            {inject: ["in_a"]},
            {},
            {},
        ],
    },
    {
        name: "round-robins a single lane across both outputs",
        steps: [
            {clear: ["out_a", "out_b"], inject: ["int_a"]},
            {clear: ["out_a", "out_b"], inject: ["int_a"]},
            {clear: ["out_a", "out_b"], inject: ["int_a"]},
            {clear: ["out_a", "out_b"], inject: ["int_a"]},
        ],
    },
    {
        name: "saturates both outputs when both lanes are saturated",
        steps: [
            {clear: ["out_a", "out_b"], inject: ["int_a", "int_b"]},
            {clear: ["out_a", "out_b"], inject: ["int_a", "int_b"]},
            {clear: ["out_a", "out_b"], inject: ["int_a", "int_b"]},
        ],
    },
    {
        name: "routes around a permanently blocked output",
        steps: [
            {inject: ["out_a", "int_a"]},
            {clear: ["out_b"], inject: ["int_a"]},
            {clear: ["out_b"], inject: ["int_a"]},
        ],
    },
];

/**
 * Runs a scenario against one engine, returning the snapshot trace.
 * @param {Function} makeAdapter
 * @param {object} scenario
 * @returns {Promise<object[]>}
 */
async function trace(makeAdapter, scenario) {
    const adapter = await makeAdapter();
    const s = adapter.addSplitter();
    const trace = [];
    scenario.steps.forEach(step => {
        (step.clear || []).forEach(port => {
            adapter.setPortItem(s[port], EMPTY);
        });
        (step.inject || []).forEach(port => {
            adapter.setPortItem(s[port], 1);
        });
        adapter.tickAll();
        trace.push(snapshot(adapter, s));
    });
    return trace;
}

scenarios.forEach(scenario => {
    test(`differential splitter: ${scenario.name}`, async () => {
        const ecs = await trace(ecsAdapter, scenario);
        const sql = await trace(sqlAdapter, scenario);
        assert.deepEqual(ecs, sql, `\nEcs: ${JSON.stringify(ecs)}\nSql: ${JSON.stringify(sql)}`);
    });
});

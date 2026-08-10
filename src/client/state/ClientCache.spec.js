import {test} from "node:test";
import assert from "node:assert/strict";
import {
    AbstractCacheView,
    AbstractCacheWriter,
    ClientCache,
    schemaScalar,
    schemaMap,
    schemaSet,
} from "@/client/state/ClientCache.js";

class RecordingWriter extends AbstractCacheWriter {

    constructor(log, label) {
        super(null);
        this._log = log;
        this._label = label;
    }

    onEvent(event) {
        this._log.push([this._label, event]);
    }
}

class NoopWriter extends AbstractCacheWriter {

    onEvent(event) {

    }
}

const NOOP_WRITER = new NoopWriter(null);

function registered() {
    const state = new ClientCache();
    state.register("demo", {
        counter: schemaScalar(0),
        byId: schemaMap(),
        members: schemaSet(),
    }, NOOP_WRITER);
    return state;
}

test("scalars read their initial, write, and notify only on change", () => {
    const state = registered();
    assert.equal(state.get("demo.counter"), 0);
    const seen = [];
    state.subscribe("demo.counter", value => seen.push(value));
    state.set("demo.counter", 5);
    state.set("demo.counter", 5);
    assert.equal(state.get("demo.counter"), 5);
    assert.deepEqual(seen, [5]);
});

test("map writes and deletes notify with (id, value); deletes pass undefined", () => {
    const state = registered();
    const seen = [];
    state.subscribe("demo.byId", (id, value) => seen.push([id, value]));
    state.mapSet("demo.byId", 7, "a");
    state.mapSet("demo.byId", 7, "a");
    state.mapDelete("demo.byId", 7);
    state.mapDelete("demo.byId", 7);
    assert.deepEqual(seen, [[7, "a"], [7, undefined]]);
    assert.equal(state.mapGet("demo.byId", 7), undefined);
});

test("mapDeleteWhere drops matching values, notifying per id", () => {
    const state = registered();
    state.mapSet("demo.byId", 1, "a");
    state.mapSet("demo.byId", 2, "b");
    state.mapSet("demo.byId", 3, "a");
    const seen = [];
    state.subscribe("demo.byId", (id, value) => seen.push([id, value]));
    state.mapDeleteWhere("demo.byId", value => value === "a");
    assert.deepEqual(seen, [[1, undefined], [3, undefined]]);
    assert.equal(state.mapGet("demo.byId", 2), "b");
});

test("set add/delete notify with (id, present); repeats notify nobody", () => {
    const state = registered();
    const seen = [];
    state.subscribe("demo.members", (id, present) => seen.push([id, present]));
    state.setAdd("demo.members", 1);
    state.setAdd("demo.members", 1);
    assert.equal(state.setHas("demo.members", 1), true);
    state.setDelete("demo.members", 1);
    state.setDelete("demo.members", 1);
    assert.deepEqual(seen, [[1, true], [1, false]]);
});

test("set replace swaps members wholesale and notifies each delta", () => {
    const state = registered();
    state.setReplace("demo.members", [1, 2]);
    const seen = [];
    state.subscribe("demo.members", (id, present) => seen.push([id, present]));
    state.setReplace("demo.members", [2, 3]);
    assert.equal(state.setHas("demo.members", 1), false);
    assert.equal(state.setHas("demo.members", 3), true);
    assert.deepEqual([...state.setValues("demo.members")], [2, 3]);
    assert.deepEqual(seen, [[1, false], [3, true]]);
});

test("undeclared paths, kind mismatches, and duplicate namespaces throw", () => {
    const state = registered();
    assert.throws(() => state.get("demo.missing"), /Undeclared state path/);
    assert.throws(() => state.get("nope.counter"), /Undeclared state path/);
    assert.throws(() => state.mapSet("demo.counter", 1, "a"), /is scalar, not map/);
    assert.throws(() => state.register("demo", {}, NOOP_WRITER), /already registered/);
    assert.throws(() => state.register("bad", {}, {onEvent() {}}), /must extend AbstractCacheWriter/);
    assert.throws(() => state.register("worse", {}, NOOP_WRITER, {}), /must extend AbstractCacheView/);
    assert.throws(
        () => state.register("typo", {counter: {kind: "scaler", initial: 5}}, NOOP_WRITER),
        /Unknown schema kind for typo.counter: scaler/,
    );
});

test("view and writer accessors return the registered parts or throw", () => {
    const state = new ClientCache();
    const view = new AbstractCacheView();
    state.register("demo", {}, NOOP_WRITER, view);
    assert.equal(state.view("demo"), view);
    assert.equal(state.writer("demo"), NOOP_WRITER);
    state.register("viewless", {}, new NoopWriter(state));
    assert.throws(() => state.view("viewless"), /No view for namespace/);
    assert.throws(() => state.writer("nope"), /No writer for namespace/);
});

test("events fan out to every writer in registration order", () => {
    const state = new ClientCache();
    const log = [];
    state.register("a", {}, new RecordingWriter(log, "a"));
    state.register("b", {}, new RecordingWriter(log, "b"));
    const event = {name: "event"};
    state.onEvent(event);
    assert.deepEqual(log, [["a", event], ["b", event]]);
});

test("unsubscribe stops notifications; a repeated call never touches other listeners", () => {
    const state = registered();
    const seen = [];
    const surviving = [];
    const unsubscribe = state.subscribe("demo.counter", value => seen.push(value));
    state.subscribe("demo.counter", value => surviving.push(value));
    state.set("demo.counter", 1);
    unsubscribe();
    unsubscribe();
    state.set("demo.counter", 2);
    assert.deepEqual(seen, [1]);
    assert.deepEqual(surviving, [1, 2]);
});

test("reset restores scalars to initial and empties maps/sets, notifying per change", () => {
    const state = registered();
    state.set("demo.counter", 5);
    state.mapSet("demo.byId", 1, "a");
    state.setAdd("demo.members", 2);
    const seen = [];
    state.subscribe("demo.counter", value => seen.push(["counter", value]));
    state.subscribe("demo.byId", (id, value) => seen.push(["byId", id, value]));
    state.subscribe("demo.members", (id, present) => seen.push(["members", id, present]));
    state.reset();
    assert.equal(state.get("demo.counter"), 0);
    assert.equal(state.mapGet("demo.byId", 1), undefined);
    assert.equal(state.setHas("demo.members", 2), false);
    assert.deepEqual(seen, [["counter", 0], ["byId", 1, undefined], ["members", 2, false]]);
});

test("schema returns every namespace's declared shape", () => {
    const state = registered();
    state.register("other", {flag: schemaScalar(0)}, new NoopWriter(state));
    assert.deepEqual(state.schema(), {
        demo: {counter: "scalar", byId: "map", members: "set"},
        other: {flag: "scalar"},
    });
});

test("dump snapshots the tree as plain JSON", () => {
    const state = registered();
    state.set("demo.counter", 3);
    state.mapSet("demo.byId", 7, {x: 1});
    state.setReplace("demo.members", [2, 4]);
    assert.deepEqual(state.dump(), {
        demo: {
            counter: 3,
            byId: {7: {x: 1}},
            members: [2, 4],
        },
    });
});

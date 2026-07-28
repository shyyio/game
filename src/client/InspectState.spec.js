import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientCache} from "@/client/ClientCache.js";
import {INSPECT_SCHEMA, InspectWriter, InspectView} from "@/client/InspectState.js";
import {InspectHeartbeatEvent, InspectClosedEvent} from "@/common/InspectEvents.js";

function inspectState() {
    const state = new ClientCache();
    state.register("inspect", INSPECT_SCHEMA, new InspectWriter(state), new InspectView());
    return {state, writer: state.writer("inspect"), view: state.view("inspect")};
}

function heartbeat(objectId) {
    return new InspectHeartbeatEvent(objectId, [0], [0], null, 10, null, null);
}

test("open and close maintain the open set and the inspect view", () => {
    const {state, writer, view} = inspectState();
    const openSets = [];
    state.subscribe("inspect.openObjects", (objectId, present) => openSets.push([objectId, present]));
    writer.open(7);
    assert.deepEqual(view.openIds(), [7]);
    assert.equal(view.isOpen(7), true);
    writer.close(7);
    assert.deepEqual(view.openIds(), []);
    assert.deepEqual(openSets, [[7, true], [7, false]]);
});

test("heartbeats store only for open menus; a close drops the stored snapshot", () => {
    const {state, writer} = inspectState();
    writer.open(7);
    state.onEvent(heartbeat(7));
    assert.equal(state.mapGet("inspect.heartbeatByObject", 7).objectId, 7);

    // In flight past a close: must not revive the panel.
    writer.close(7);
    state.onEvent(heartbeat(7));
    assert.equal(state.mapGet("inspect.heartbeatByObject", 7), undefined);
    state.onEvent(heartbeat(9));
    assert.equal(state.mapGet("inspect.heartbeatByObject", 9), undefined);
});

test("a sim-side close event closes the menu", () => {
    const {state, writer, view} = inspectState();
    writer.open(7);
    state.onEvent(heartbeat(7));
    state.onEvent(new InspectClosedEvent(7));
    assert.equal(view.isOpen(7), false);
    assert.equal(state.mapGet("inspect.heartbeatByObject", 7), undefined);
});

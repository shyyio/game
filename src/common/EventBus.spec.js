import {test} from "node:test";
import assert from "node:assert/strict";
import {EventBus} from "@/common/EventBus.js";
import {CapturingSession} from "@/test/CapturingSession.js";

// Test events routing through a fixed topic.
function chunkEvent(chunk) {
    return {chunk, subscribersIn: bus => bus.chunkSubscribers(chunk)};
}

function objectEvent(objectId) {
    return {objectId, subscribersIn: bus => bus.objectSubscribers(objectId)};
}

test("addSession allocates ascending ids", () => {
    const bus = new EventBus();
    assert.equal(bus.addSession(new CapturingSession()), 1);
    assert.equal(bus.addSession(new CapturingSession()), 2);
});

test("setViewport reports the added/removed chunk delta", () => {
    const bus = new EventBus();
    const id = bus.addSession(new CapturingSession());

    assert.deepEqual(bus.setViewport(id, [10, 11, 12]), {added: [10, 11, 12], removed: []});
    const delta = bus.setViewport(id, [11, 12, 13]);
    assert.deepEqual(delta.added, [13]);
    assert.deepEqual(delta.removed, [10]);
});

test("publish fans a chunk event to every subscribed session and no others", () => {
    const bus = new EventBus();
    const watcher = new CapturingSession();
    const bystander = new CapturingSession();
    const watcherId = bus.addSession(watcher);
    const bystanderId = bus.addSession(bystander);
    bus.setViewport(watcherId, [10]);
    bus.setViewport(bystanderId, [99]);

    const event = chunkEvent(10);
    bus.publish(event);

    assert.deepEqual(watcher.events, [event]);
    assert.deepEqual(bystander.events, []);
});

test("publishTo delivers to one session only", () => {
    const bus = new EventBus();
    const a = new CapturingSession();
    const b = new CapturingSession();
    const aId = bus.addSession(a);
    bus.addSession(b);

    const event = chunkEvent(10);
    bus.publishTo(aId, event);

    assert.deepEqual(a.events, [event]);
    assert.deepEqual(b.events, []);
});

test("removeSession stops all delivery to that session", () => {
    const bus = new EventBus();
    const session = new CapturingSession();
    const id = bus.addSession(session);
    bus.setViewport(id, [10]);
    bus.removeSession(id);

    bus.publish(chunkEvent(10));

    assert.deepEqual(session.events, []);
});

test("an object event fans to every inspecting session", () => {
    const bus = new EventBus();
    const a = new CapturingSession();
    const b = new CapturingSession();
    const aId = bus.addSession(a);
    const bId = bus.addSession(b);
    bus.setInspects(aId, [7]);
    bus.setInspects(bId, [7]);

    const event = objectEvent(7);
    bus.publish(event);

    assert.deepEqual(a.events, [event]);
    assert.deepEqual(b.events, [event]);
});

test("subscribedObjects returns the union of inspected ids", () => {
    const bus = new EventBus();
    const aId = bus.addSession(new CapturingSession());
    const bId = bus.addSession(new CapturingSession());
    bus.setInspects(aId, [7, 8]);
    bus.setInspects(bId, [8, 9]);

    assert.deepEqual(bus.subscribedObjects().sort(), [7, 8, 9]);
});

test("clearObject drops every subscription to that object", () => {
    const bus = new EventBus();
    const session = new CapturingSession();
    const id = bus.addSession(session);
    bus.setInspects(id, [7]);

    bus.clearObject(7);

    assert.deepEqual(bus.subscribedObjects(), []);
    bus.publish(objectEvent(7));
    assert.deepEqual(session.events, []);
});

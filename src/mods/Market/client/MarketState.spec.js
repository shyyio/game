import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientCache} from "@/client/ClientCache.js";
import {MARKET_SCHEMA, MarketWriter} from "./MarketState.js";
import {MarketSnapshotRequestMessage} from "../common/messages.js";
import {MarketSnapshotEvent} from "../common/events.js";

function stateWithSession() {
    const sent = [];
    const session = {sendMessage: message => sent.push(message)};
    const state = new ClientCache();
    state.register("market", MARKET_SCHEMA, new MarketWriter(state, session));
    return {state, sent};
}

test("openConfig sets the target and requests its snapshot", () => {
    const {state, sent} = stateWithSession();
    state.writer("market").openConfig(42);
    assert.equal(state.get("market.configTarget"), 42);
    assert.equal(sent.length, 1);
    assert.ok(sent[0] instanceof MarketSnapshotRequestMessage);
    assert.equal(sent[0].objectId, 42);
});

test("openConfig clears any stale snapshot from a previous target", () => {
    const {state} = stateWithSession();
    state.onEvent(new MarketSnapshotEvent([1], [2], [3], [4], [5], 0, 1, 2));
    state.writer("market").openConfig(42);
    assert.equal(state.get("market.snapshot"), null);
});

test("closeConfig clears the target", () => {
    const {state} = stateWithSession();
    state.writer("market").openConfig(42);
    state.writer("market").closeConfig();
    assert.equal(state.get("market.configTarget"), null);
});

test("a MarketSnapshotEvent is stored verbatim", () => {
    const {state} = stateWithSession();
    const event = new MarketSnapshotEvent([1], [2], [3], [4], [5], 0, 1, 2);
    state.onEvent(event);
    assert.equal(state.get("market.snapshot"), event);
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientCache} from "@/client/state/ClientCache.js";
import {CLOCK_SCHEMA, ClockWriter, ClockView} from "@/client/state/ClockState.js";
import {TickEndEvent} from "@/common/CoreEvents.js";

function clockState() {
    const state = new ClientCache();
    state.register("clock", CLOCK_SCHEMA, new ClockWriter(state), new ClockView());
    return {state, clock: state.view("clock")};
}

test("the clock reads 0 until the first heartbeat", () => {
    const {clock} = clockState();
    assert.equal(clock.tick(), 0);
});

test("each heartbeat replaces the clock", () => {
    const {state, clock} = clockState();

    state.onEvent(new TickEndEvent(41));
    assert.equal(clock.tick(), 41);
    state.onEvent(new TickEndEvent(42));
    assert.equal(clock.tick(), 42);
});

test("subscribers hear every tick", () => {
    const {state} = clockState();
    const seen = [];
    state.subscribe("clock.tick", (tick) => seen.push(tick));

    state.onEvent(new TickEndEvent(1));
    state.onEvent(new TickEndEvent(2));

    assert.deepEqual(seen, [1, 2]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {commitStagedHops} from "./portRelay.js";
import {EMPTY} from "@spup/sdk";

/**
 * Records the port writes a commit makes, in order.
 */
class RecordingEngine {

    constructor() {
        this.calls = [];
        this.ports = {
            setItem: (port, item) => this.calls.push(["setItem", port, item]),
            consumeItem: (port) => this.calls.push(["consumeItem", port]),
        };
    }
}

test("clears the vacated internal ports before the incoming items refill them", () => {
    const engine = new RecordingEngine();
    const outputFills = [];
    const stage1 = [{intPort: 10, item: 7, inPort: 20}];
    const stage2 = [{outPort: 30, item: 4, intPort: 10}];

    commitStagedHops(engine, stage1, stage2, outputFills);

    assert.deepEqual(engine.calls, [
        ["setItem", 10, EMPTY],
        ["consumeItem", 20],
        ["setItem", 10, 7],
    ]);
});

test("defers the out-port fills onto outputFills", () => {
    const engine = new RecordingEngine();
    const outputFills = [];
    const stage2 = [{outPort: 30, item: 4, intPort: 10}];

    commitStagedHops(engine, [], stage2, outputFills);

    assert.deepEqual(outputFills, stage2);
});

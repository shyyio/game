import {test} from "node:test";
import assert from "node:assert";

import {ErrorReporter} from "@/common/ErrorReporter.js";

const ENDPOINT = "https://bugs.example.com/report";

/**
 * @param {(endpoint: string, body: string) => Promise<*>} [transport]
 * @returns {{reporter: ErrorReporter, bodies: Array<object>}}
 */
function makeReporter(transport) {
    const bodies = [];
    const send = (endpoint, body) => {
        bodies.push(JSON.parse(body));
        if (transport !== undefined) {
            return transport(endpoint, body);
        }
        return Promise.resolve();
    };
    const reporter = new ErrorReporter(ENDPOINT, "abc123", () => "wss://ca1.example.com:443", send);
    return {reporter, bodies};
}

test("report posts the full payload", async () => {
    const {reporter, bodies} = makeReporter();

    await reporter.report("boom", "at one\nat two", {service: "game"});

    assert.deepStrictEqual(bodies, [{
        message: "boom",
        stack: "at one\nat two",
        buildVersion: "abc123",
        url: "wss://ca1.example.com:443",
        extra: {service: "game"},
    }]);
});

test("report omits extra when none is given", async () => {
    const {reporter, bodies} = makeReporter();

    await reporter.report("boom", "at one");

    assert.strictEqual("extra" in bodies[0], false);
});

test("reportError takes an Error's message and stack", async () => {
    const {reporter, bodies} = makeReporter();
    const error = new Error("exploded");

    await reporter.reportError(error, "Uncaught exception");

    assert.strictEqual(bodies[0].message, "exploded");
    assert.strictEqual(bodies[0].stack, error.stack);
});

test("reportError labels a non-Error throw with the fallback prefix", async () => {
    const {reporter, bodies} = makeReporter();

    await reporter.reportError("nope", "Unhandled rejection");

    assert.strictEqual(bodies[0].message, "Unhandled rejection: nope");
    assert.strictEqual(bodies[0].stack, "Unhandled rejection: nope");
});

test("a repeated fingerprint sends once", async () => {
    const {reporter, bodies} = makeReporter();

    await reporter.report("boom", "at one\nat two");
    await reporter.report("boom", "at one\nat two");

    assert.strictEqual(bodies.length, 1);
});

test("the same message from a different stack still sends", async () => {
    const {reporter, bodies} = makeReporter();

    await reporter.report("boom", "at one");
    await reporter.report("boom", "at other");

    assert.strictEqual(bodies.length, 2);
});

test("an over-long message is truncated to the byte cap", async () => {
    const {reporter, bodies} = makeReporter();

    await reporter.report("x".repeat(2000), "at one");

    assert.strictEqual(bodies[0].message.length, 1024);
});

test("truncation never splits a multi-byte character", async () => {
    const {reporter, bodies} = makeReporter();
    // Each emoji is a surrogate pair worth 4 UTF-8 bytes, so the 1024-byte cap lands mid-pair.
    await reporter.report("😀".repeat(400), "at one");

    const message = bodies[0].message;
    assert.strictEqual(message.length % 2, 0);
    assert.strictEqual(new TextEncoder().encode(message).length, 1024);
    assert.strictEqual(message, "😀".repeat(256));
});

test("a failing transport is swallowed", async () => {
    const {reporter} = makeReporter(() => Promise.reject(new Error("network down")));

    await reporter.report("boom", "at one");
});

test("a transport throwing synchronously is swallowed", async () => {
    const {reporter} = makeReporter(() => {
        throw new Error("no fetch here");
    });

    await reporter.report("boom", "at one");
});

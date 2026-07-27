import {test} from "node:test";
import assert from "node:assert/strict";
import {WebSocketSession} from "@/server/WebSocketSession.js";

const SEND_OK = 1;

class FakeWs {

    constructor() {
        this.sent = [];
        this.endedWith = null;
    }

    send(bytes) {
        this.sent.push(bytes);
        return SEND_OK;
    }

    getBufferedAmount() {
        return 0;
    }

    cork(fn) {
        fn();
    }

    end(code) {
        this.endedWith = code;
    }
}

function makeSession(ws) {
    // Encode stamps a fixed-size frame per event; the session only needs lengths.
    const api = {wire: {encode: event => new Uint8Array(event.size)}};
    return new WebSocketSession(api, ws, 1);
}

test("publishEvent counts tx bytes and sends through the queue", () => {
    const ws = new FakeWs();
    const session = makeSession(ws);
    session.publishEvent({size: 100});
    session.publishEvent({size: 24});
    assert.equal(session.txBytes, 124);
    assert.equal(ws.sent.length, 2);
});

test("a closed session stops counting and sending", () => {
    const ws = new FakeWs();
    const session = makeSession(ws);
    session.publishEvent({size: 100});
    session.markClosed();
    session.publishEvent({size: 50});
    assert.equal(session.txBytes, 100);
    assert.equal(ws.sent.length, 1);
});

test("kick ends the socket once and mutes the session", () => {
    const ws = new FakeWs();
    const session = makeSession(ws);
    session.kick(4003);
    assert.equal(ws.endedWith, 4003);
    session.kick(4000);
    assert.equal(ws.endedWith, 4003, "second kick is a no-op");
    session.publishEvent({size: 10});
    assert.equal(session.txBytes, 0);
});

test("server sessions never send messages", () => {
    const session = makeSession(new FakeWs());
    assert.throws(() => session.sendMessage({}), /does not send/);
});

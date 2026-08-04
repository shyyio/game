import {test} from "node:test";
import assert from "node:assert/strict";
import {OutboundQueue} from "@/server/OutboundQueue.js";
import {CLOSE_CODE_SLOW_CONSUMER} from "@/common/CloseCodes.js";

const SEND_DROPPED = 0;
const SEND_OK = 1;
const SEND_BACKPRESSURE = 2;

class FakeSocket {

    constructor() {
        this.sent = [];
        this.buffered = 0;
        this.closedWith = null;
        this.sendResult = SEND_OK;
    }

    send(bytes) {
        this.sent.push(bytes);
        return this.sendResult;
    }

    bufferedAmount() {
        return this.buffered;
    }

    cork(flushBody) {
        flushBody();
    }

    close(code) {
        this.closedWith = code;
    }
}

function frame(size, fill) {
    return new Uint8Array(size).fill(fill);
}

test("frames flow through in FIFO order", () => {
    const socket = new FakeSocket();
    const queue = new OutboundQueue(socket);
    queue.push(frame(4, 1));
    queue.push(frame(4, 2));
    queue.push(frame(4, 3));
    assert.equal(socket.sent.length, 3);
    assert.deepEqual(socket.sent.map(bytes => bytes[0]), [1, 2, 3]);
    assert.equal(queue.queuedBytes, 0);
});

test("sending stops at the high-water mark and resumes on drain", () => {
    const socket = new FakeSocket();
    const queue = new OutboundQueue(socket);
    socket.buffered = 512 * 1024;
    queue.push(frame(8, 1));
    queue.push(frame(8, 2));
    assert.equal(socket.sent.length, 0, "nothing sent past high water");
    assert.equal(queue.queuedBytes, 16);

    socket.buffered = 0;
    queue.onDrain();
    assert.equal(socket.sent.length, 2);
    assert.equal(queue.queuedBytes, 0);
});

test("backpressure-accepted sends keep flowing until high water", () => {
    const socket = new FakeSocket();
    const queue = new OutboundQueue(socket);
    socket.sendResult = SEND_BACKPRESSURE;
    queue.push(frame(8, 1));
    queue.push(frame(8, 2));
    assert.equal(socket.sent.length, 2, "buffered-by-uWS frames still count as sent");
});

test("a dropped send closes the socket as a slow consumer", () => {
    const socket = new FakeSocket();
    const queue = new OutboundQueue(socket);
    socket.sendResult = SEND_DROPPED;
    queue.push(frame(8, 1));
    assert.equal(socket.closedWith, CLOSE_CODE_SLOW_CONSUMER);
    queue.push(frame(8, 2));
    assert.equal(socket.sent.length, 1, "a closed queue drops further frames");
});

test("exceeding the byte cap closes the socket", () => {
    const socket = new FakeSocket();
    const queue = new OutboundQueue(socket);
    socket.buffered = 512 * 1024;
    // 5 MiB queued while the socket refuses to drain.
    for (let i = 0; i < 5; i += 1) {
        queue.push(frame(1024 * 1024, i));
    }
    assert.equal(socket.closedWith, CLOSE_CODE_SLOW_CONSUMER);
    assert.equal(queue.queuedBytes, 0, "queue emptied on close");
});

test("markClosed drops the queue without touching the socket", () => {
    const socket = new FakeSocket();
    const queue = new OutboundQueue(socket);
    socket.buffered = 512 * 1024;
    queue.push(frame(8, 1));
    queue.markClosed();
    assert.equal(queue.queuedBytes, 0);
    socket.buffered = 0;
    queue.onDrain();
    assert.equal(socket.sent.length, 0);
    assert.equal(socket.closedWith, null);
});

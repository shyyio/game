// Stop feeding the socket once uWS is buffering this much; the drain callback resumes.
const BACKPRESSURE_HIGH_WATER = 256 * 1024;

// A consumer this far behind is not coming back; disconnect instead of buffering forever.
const MAX_QUEUED_BYTES = 4 * 1024 * 1024;

// 4000-4999 is the application close-code range.
export const CLOSE_CODE_SLOW_CONSUMER = 4000;

// uWS send() results.
const SEND_DROPPED = 0;
const SEND_OK = 1;
const SEND_BACKPRESSURE = 2;

/**
 * Per-session outbound frame queue: push never blocks, frames flow to the socket only while its
 * buffer sits under the high-water mark, and the drain callback resumes the flush. The socket is a
 * facade ({send, bufferedAmount, cork, close}) so the queue tests without a network.
 */
export class OutboundQueue {

    /**
     * @param {{send: function(Uint8Array): number, bufferedAmount: function(): number, cork: function(function(): void): void, close: function(number): void}} socket
     */
    constructor(socket) {
        this._socket = socket;
        this._frames = [];
        this._head = 0;
        this._queuedBytes = 0;
        this._closed = false;
    }

    /**
     * @returns {number} bytes waiting in the queue (excluding uWS's own buffer)
     */
    get queuedBytes() {
        return this._queuedBytes;
    }

    /**
     * Enqueues one encoded frame and flushes as far as backpressure allows.
     * @param {Uint8Array} bytes
     * @returns {void}
     */
    push(bytes) {
        if (this._closed) {
            return;
        }
        this._frames.push(bytes);
        this._queuedBytes += bytes.length;
        if (this._queuedBytes > MAX_QUEUED_BYTES) {
            this._close();
            return;
        }
        this.flush();
    }

    /**
     * Sends queued frames until the queue empties or the socket buffer crosses the high-water mark,
     * corked once so a burst of frames batches into fewer TCP writes.
     * @returns {void}
     */
    flush() {
        if (this._closed || this._head === this._frames.length) {
            return;
        }
        this._socket.cork(() => {
            while (!this._closed && this._head < this._frames.length) {
                if (this._socket.bufferedAmount() >= BACKPRESSURE_HIGH_WATER) {
                    return;
                }
                const frame = this._frames[this._head];
                const result = this._socket.send(frame);
                if (result === SEND_DROPPED) {
                    // Over uWS's own maxBackpressure: the frame is lost, the stream is broken.
                    this._close();
                    return;
                }
                this._head += 1;
                this._queuedBytes -= frame.length;
                // SEND_BACKPRESSURE means the frame was buffered; keep going until high water says stop.
            }
            this._compact();
        });
    }

    /**
     * The uWS drain callback: socket buffer fell, resume the flush.
     * @returns {void}
     */
    onDrain() {
        this.flush();
    }

    /**
     * Drops the queue once the socket is gone (uWS close callback).
     * @returns {void}
     */
    markClosed() {
        this._closed = true;
        this._frames = [];
        this._head = 0;
        this._queuedBytes = 0;
    }

    /**
     * @private
     * @returns {void}
     */
    _close() {
        if (!this._closed) {
            this._socket.close(CLOSE_CODE_SLOW_CONSUMER);
        }
        this.markClosed();
    }

    /**
     * Frees sent frames without an O(n) shift per send.
     * @private
     * @returns {void}
     */
    _compact() {
        if (this._head === this._frames.length) {
            this._frames = [];
            this._head = 0;
        } else if (this._head > this._frames.length / 2) {
            this._frames = this._frames.slice(this._head);
            this._head = 0;
        }
    }
}

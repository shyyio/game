import {DEV, BROWSER} from "@/common/env.js";
import {AbstractSession} from "@/common/AbstractSession.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";

// Browser-only: fake per-chunk load latency so the connecting/loading status is visible in
// single-player, where chunk events would otherwise resolve synchronously. Off under Node
// tests, which assert on synchronous delivery.
const SIMULATE_CHUNK_LATENCY = DEV && BROWSER;
const SIM_CHUNK_LATENCY_MS = 20;

export class LocalSession extends AbstractSession {

    constructor(api) {
        super(api);
        // Ordered delivery queue for the simulated chunk-load latency (dev only).
        this._chunkQueue = [];
        this._draining = false;
    }

    setId(sessionId) {
        this.id = sessionId;
    }

    sendMessage(message) {
        if (DEV) {
            // Test wire encoding/decoding
            this.api.sendMessage(this.api.wire.decode(this.api.wire.encode(message)), this);
        } else {
            this.api.sendMessage(message, this);
        }
    }

    publishEvent(event) {
        if (this.client == null) {
            return;
        }
        if (!DEV) {
            this.client.publishEvent(event);
            return;
        }
        // Chunk lifecycle events drip through one ordered delay queue so the loading
        // status is visible and subscribe/sync/unsubscribe stay ordered; everything
        // else delivers immediately.
        if (SIMULATE_CHUNK_LATENCY && this._isChunkEvent(event)) {
            this._chunkQueue.push(event);
            this._drainChunkQueue();
            return;
        }
        this._deliver(event);
    }

    /**
     * @private
     * @param {AbstractEvent} event
     * @returns {boolean}
     */
    _isChunkEvent(event) {
        return event instanceof ChunkSubscribeEvent
            || event instanceof ChunkSyncEvent;
    }

    /**
     * Delivers one queued chunk event per {@link SIM_CHUNK_LATENCY_MS}, preserving order.
     * @private
     * @returns {void}
     */
    _drainChunkQueue() {
        if (this._draining) {
            return;
        }
        const event = this._chunkQueue.shift();
        if (event === undefined) {
            return;
        }
        this._draining = true;
        setTimeout(() => {
            this._draining = false;
            this._deliver(event);
            this._drainChunkQueue();
        }, SIM_CHUNK_LATENCY_MS);
    }

    /**
     * Round-trips an event through the wire codec and hands it to the client.
     * @private
     * @param {AbstractEvent} event
     * @returns {void}
     */
    _deliver(event) {
        if (this.client == null) {
            return;
        }
        const encoded = this.api.wire.encode(event);
        this.client.publishEvent(this.api.wire.decode(encoded), encoded.length);
    }
}

import {ChunkSyncEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {formatBytes} from "@/common/util.js";
import {ListenerList} from "@/common/ListenerList.js";
import {DEV, BROWSER} from "@/common/env.js";

// Frame time spent applying queued sync events; about a sixth of a 60fps frame.
const DRAIN_BUDGET_MS = 2.5;

// Leading entries shown per column when logging a columnar batch event.
const LOG_BATCH_ITEMS = 5;

/**
 * A console view of an event: a batch event's columns cut to their first {@link LOG_BATCH_ITEMS}
 * entries, a sync bundle's inner events mapped the same way; other events log as-is.
 * @param {AbstractEvent} event
 * @returns {object}
 */
function eventLogView(event) {
    if (event instanceof ChunkSyncEvent) {
        return {event: event.constructor.name, chunk: event.chunk, events: event.events.map(eventLogView)};
    }
    if (!(event instanceof AbstractBatchEvent)) {
        return event;
    }
    const view = {event: event.constructor.name};
    for (const [field, type] of Object.entries(event.constructor.wireFields)) {
        const value = event[field];
        if (type.endsWith("[]") && value.length > LOG_BATCH_ITEMS) {
            view[field] = `[${value.slice(0, LOG_BATCH_ITEMS).join(", ")}, … ${value.length} total]`;
        } else {
            view[field] = value;
        }
    }
    return view;
}

/**
 * Every event the session delivers: the arrival gate that keeps a chunk's events in order behind
 * its queued sync, the budgeted per-frame drain, and the fan-out to the client's consumers.
 */
export class EventQueue {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        // Per-delta events awaiting the budgeted per-frame drain: a chunk-sync bundle explodes to
        // hundreds of cache writes + sprite builds. Later events queue only when their own chunk
        // still has queued sync (per-chunk order); everything else applies on arrival, so live
        // tick traffic for already-synced chunks can never pile up behind a loading burst.
        this._pendingEvents = [];
        // chunk -> its queued event count; a chunk with an entry gates its later events.
        this._queuedCountByChunk = new Map();
        // Host event listeners, the last stop of the event fan-out.
        this._eventListeners = new ListenerList();
        this._bytesReceived = 0;
        this._logging = false;
    }

    /**
     * Logs every arriving event to the console with its wire size (dev builds only).
     * @param {boolean} enabled
     * @returns {void}
     */
    setLogging(enabled) {
        this._logging = enabled;
    }

    /**
     * @param {AbstractEvent} event
     * @param {number} [bytes] - protobuf bytes this event arrived as (dev only; 0 for the
     *     inner events of a re-published bundle, already counted in the bundle)
     */
    publish(event, bytes=0) {
        if (DEV && BROWSER) {
            this._bytesReceived += bytes;
            // Logging every event costs a DevTools stack capture each and retains the payloads;
            // only in debug mode, and batch events cut to their leading column entries.
            if (bytes > 0 && this._logging) {
                // this event's size, then the session total
                console.log(`↓ [${formatBytes(bytes).padStart(6)} / ${formatBytes(this._bytesReceived).padStart(6)}]`, event.constructor.name, eventLogView(event));
            }
        }
        if (event instanceof ChunkSyncEvent) {
            // A chunk-sync bundle: queue each inner event, exploded to its per-delta events so
            // the drain budget counts real applications, not envelopes. Sync events are distinct
            // types (e.g. ObjectSyncEvent vs ObjectInsertEvent), so handlers can already tell a load
            // from a live change.
            for (const inner of event.events) {
                let deltas;
                if (inner instanceof AbstractBatchEvent) {
                    deltas = inner.explode();
                } else {
                    deltas = [inner];
                }
                for (const delta of deltas) {
                    this._queueEvent(delta);
                }
            }
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            if (this._queuedCountByChunk.has(event.chunk)) {
                // The chunk left the viewport before its queued sync applied: the unsubscribe
                // wipes that state anyway, so drop the queue's share of it first.
                this._pendingEvents = this._pendingEvents.filter(pending => pending.chunk !== event.chunk);
                this._queuedCountByChunk.delete(event.chunk);
            }
            // Tearing down a chunk's entries and sprites is heavy too: a prune pass drops many
            // chunks at once, so unsubscribes ride the budgeted drain, one chunk per event.
            this._queueEvent(event);
            return;
        }
        if (event.chunk !== undefined && this._queuedCountByChunk.has(event.chunk)) {
            // The event's chunk still has queued sync: apply behind it, keeping per-chunk order.
            this._queueEvent(event);
            return;
        }
        this._applyEvent(event);
    }

    /**
     * Applies queued events for up to {@link DRAIN_BUDGET_MS}, once per frame.
     * @returns {void}
     */
    drain() {
        if (this._pendingEvents.length === 0) {
            return;
        }
        const started = performance.now();
        let applied = 0;
        while (applied < this._pendingEvents.length && performance.now() - started < DRAIN_BUDGET_MS) {
            const event = this._pendingEvents[applied];
            applied += 1;
            const count = this._queuedCountByChunk.get(event.chunk);
            if (count === 1) {
                this._queuedCountByChunk.delete(event.chunk);
            } else {
                this._queuedCountByChunk.set(event.chunk, count - 1);
            }
            this._applyEvent(event);
        }
        this._pendingEvents.splice(0, applied);
    }

    /**
     * Registers a host event listener, called with every applied event; the listener filters by
     * instanceof (transient outcomes like ClaimResultEvent never enter the state tree).
     * @param {function(AbstractEvent): void} listener
     * @returns {function(): void} unsubscribe
     */
    onEvent(listener) {
        return this._eventListeners.add(listener);
    }

    /**
     * Queues one event for the budgeted drain, gating its chunk's later events behind it.
     * @private
     * @param {AbstractEvent} event
     * @returns {void}
     */
    _queueEvent(event) {
        this._pendingEvents.push(event);
        const count = this._queuedCountByChunk.get(event.chunk);
        let nextCount;
        if (count === undefined) {
            nextCount = 1;
        } else {
            nextCount = count + 1;
        }
        this._queuedCountByChunk.set(event.chunk, nextCount);
    }

    /**
     * Fans one event out to every client consumer: the cache writers first (readers see settled
     * state), then the mods, layers, and host listeners. State reactions ride cache subscriptions.
     * @private
     * @param {AbstractEvent} event
     * @returns {void}
     */
    _applyEvent(event) {
        if (event instanceof AbstractBatchEvent) {
            // A chunk's packed deltas: replay each as the per-delta event handlers already expect.
            for (const inner of event.explode()) {
                this._applyEvent(inner);
            }
            return;
        }
        this._client.cache.onEvent(event);
        for (const mod of this._client.modRegistry.clientMods) {
            mod.onEvent(event, this._client);
        }
        this._client.drawLayerRegistry.dispatchEvent(event);
        // The status HUD isn't a viewport draw layer, so feed it chunk events directly.
        this._client.hud.statusLayer.onEvent(event);
        this._eventListeners.notify(event);
    }

}

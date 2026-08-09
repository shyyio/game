import {
    MetricsFact, METRICS_FACT_TYPE_PLAYER_JOINED, METRICS_FACT_TYPE_PLAYER_LEFT,
    METRICS_QUERY_SCOPE_GLOBAL, metricsRollupKey,
} from "@/common/MetricsFact.js";
import {MetricsRollupEvent, MetricsRollupBucketEvent, compactRollupRows} from "@/common/MetricsEvents.js";
import {
    MetricsRollupRequestMessage, MetricsSubscribeMessage, MetricsUnsubscribeMessage,
} from "@/common/MetricsMessages.js";

/**
 * One session's live rollup subscription for one (metricsType, scope) key.
 */
class MetricsSubscription {

    /**
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} bucketTicks
     * @param {number} windowTicks
     * @param {number} generation
     */
    constructor(metricsType, scope, bucketTicks, windowTicks, generation) {
        this.metricsType = metricsType;
        this.scope = scope;
        this.bucketTicks = bucketTicks;
        this.windowTicks = windowTicks;
        this.generation = generation;
    }
}

/**
 * The sim's whole metrics surface: buffers facts for batched persistence, tracks session lengths,
 * and serves the metrics query/subscribe/unsubscribe messages plus the host's periodic push.
 */
export class GameMetrics {

    /**
     * @param {AbstractMetricsStore} [store] - omitted when metrics is off; record() then drops facts instead of buffering them
     * @param {ModRegistry} modRegistry - source of the GLOBAL-query declarations
     * @param {EventBus} bus
     * @param {GameEngine} simEngine - source of the tick clock
     */
    constructor(store, modRegistry, bus, simEngine) {
        this._store = store;
        this._modRegistry = modRegistry;
        this._bus = bus;
        this._simEngine = simEngine;
        this._buffer = [];

        simEngine.setMetricsSink(
            (type, playerId, category, amount, tag) => this.record(type, playerId, category, amount, tag),
        );

        /**
         * sessionId -> join timestamp (epoch ms), so disconnect can record session length.
         * @type {Map<number, number>}
         * @private
         */
        this._sessionJoinedAt = new Map();

        /**
         * sessionId -> (metricsRollupKey(metricsType, scope) -> MetricsSubscription).
         * @type {Map<number, Map<number, MetricsSubscription>>}
         * @private
         */
        this._subscriptions = new Map();
    }

    /**
     * @param {number} type METRICS_FACT_TYPE_*
     * @param {number} playerId PLAYER_ID_NONE when not player-scoped
     * @param {number} [category]
     * @param {number} [amount]
     * @param {number} [tag]
     * @returns {void}
     */
    record(type, playerId, category, amount, tag) {
        if (this._store === undefined) {
            return;
        }
        this._buffer.push(new MetricsFact(type, this._simEngine.clock, playerId, category, amount, tag));
    }

    /**
     * Records the join fact and the join time the disconnect fact's session length derives from.
     * @param {AbstractSession} session
     * @returns {void}
     */
    onConnect(session) {
        this._sessionJoinedAt.set(session.id, Date.now());
        this.record(METRICS_FACT_TYPE_PLAYER_JOINED, session.playerId);
    }

    /**
     * Records the leave fact (amount = session length, ms) and drops the session's subscriptions;
     * call before the bus forgets the session.
     * @param {number} sessionId
     * @returns {void}
     */
    onDisconnect(sessionId) {
        const playerId = this._bus.playerIdOf(sessionId);
        const joinedAt = this._sessionJoinedAt.get(sessionId);
        const sessionLengthMs = joinedAt === undefined ? 0 : Date.now() - joinedAt;
        this._sessionJoinedAt.delete(sessionId);
        this.record(METRICS_FACT_TYPE_PLAYER_LEFT, playerId, undefined, sessionLengthMs);
        this._subscriptions.delete(sessionId);
    }

    /**
     * Serves the metrics wire messages; returns true if the message was one.
     * @param {AbstractSession} session
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    handleMessage(session, message) {
        if (message instanceof MetricsRollupRequestMessage) {
            this._handleRollupRequest(session, message);
            return true;
        }
        if (message instanceof MetricsSubscribeMessage) {
            this._handleSubscribe(session, message);
            return true;
        }
        if (message instanceof MetricsUnsubscribeMessage) {
            this._handleUnsubscribe(session, message);
            return true;
        }
        return false;
    }

    /**
     * Hands the buffered facts to the store and prunes past the retention window.
     * @returns {Promise<void>}
     */
    async flush() {
        if (this._store === undefined) {
            return;
        }
        const facts = this._buffer;
        this._buffer = [];
        await this._store.recordBatch(facts);
        await this._store.pruneTo(this._simEngine.clock);
    }

    /**
     * The host's end-of-tick fire-and-forget: flush, then push every due subscription.
     * @returns {void}
     */
    flushAndPush() {
        this.flush()
            .then(() => this.push())
            .catch(error => console.error("Metrics flush failed:", error));
    }

    /**
     * Closes the underlying store; a no-op when no store was given.
     * @returns {Promise<void>}
     */
    async close() {
        if (this._store === undefined) {
            return;
        }
        await this._store.close();
    }

    /**
     * Pushes every subscription's just-completed bucket, grouped by identical (metricsType, scope, bucketTicks, playerId).
     * @returns {void}
     */
    push() {
        const toTick = this._simEngine.clock;
        // signature -> {metricsType, scope, playerId, bucketTick, bucketTicks, recipients}
        const groups = new Map();
        for (const [sessionId, subs] of this._subscriptions) {
            for (const sub of subs.values()) {
                if (toTick % sub.bucketTicks !== 0) {
                    continue;
                }
                const bucketTick = toTick - sub.bucketTicks;
                if (bucketTick < 0) {
                    // The very first possible bucket hasn't happened yet — nothing to report.
                    continue;
                }
                const playerId = this._playerIdForScope(sub.scope, sessionId);
                const signature = `${sub.metricsType}:${sub.scope}:${sub.bucketTicks}:${bucketTick}:${playerId}`;
                let group = groups.get(signature);
                if (group === undefined) {
                    group = {
                        metricsType: sub.metricsType, scope: sub.scope, playerId,
                        bucketTick, bucketTicks: sub.bucketTicks, recipients: [],
                    };
                    groups.set(signature, group);
                }
                group.recipients.push({sessionId, windowTicks: sub.windowTicks});
            }
        }
        for (const group of groups.values()) {
            this._publishBucket(
                group.recipients, group.metricsType, group.scope, group.playerId,
                group.bucketTick, toTick, group.bucketTicks,
            );
        }
    }

    /**
     * GLOBAL is unscoped; OWN resolves the session's own playerId (never client-supplied).
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} sessionId
     * @returns {number|null}
     * @private
     */
    _playerIdForScope(scope, sessionId) {
        if (scope === METRICS_QUERY_SCOPE_GLOBAL) {
            return null;
        }
        return this._bus.playerIdOf(sessionId);
    }

    /**
     * @param {AbstractSession} session
     * @param {MetricsRollupRequestMessage} message
     * @returns {void}
     * @private
     */
    _handleRollupRequest(session, message) {
        this._publishRollup(
            [session.id], message.metricsType, message.scope, this._playerIdForScope(message.scope, session.id),
            message.fromTick, message.toTick, message.bucketTicks,
        );
    }

    /**
     * Stores the subscription and answers immediately; generation counter guards against out-of-order re-subscribes.
     * @param {AbstractSession} session
     * @param {MetricsSubscribeMessage} message
     * @returns {void}
     * @private
     */
    _handleSubscribe(session, message) {
        let subs = this._subscriptions.get(session.id);
        if (subs === undefined) {
            subs = new Map();
            this._subscriptions.set(session.id, subs);
        }
        const key = metricsRollupKey(message.metricsType, message.scope);
        const previous = subs.get(key);
        const generation = previous === undefined ? 0 : previous.generation + 1;
        subs.set(key, new MetricsSubscription(
            message.metricsType, message.scope, message.bucketTicks, message.windowTicks, generation,
        ));

        const toTick = this._simEngine.clock;
        const fromTick = Math.max(0, toTick - message.windowTicks);
        this._publishRollup(
            [session.id], message.metricsType, message.scope, this._playerIdForScope(message.scope, session.id),
            fromTick, toTick, message.bucketTicks,
            () => {
                const current = subs.get(key);
                return current !== undefined && current.generation === generation;
            },
        );
    }

    /**
     * @param {AbstractSession} session
     * @param {MetricsUnsubscribeMessage} message
     * @returns {void}
     * @private
     */
    _handleUnsubscribe(session, message) {
        const subs = this._subscriptions.get(session.id);
        if (subs === undefined) {
            return;
        }
        subs.delete(metricsRollupKey(message.metricsType, message.scope));
    }

    /**
     * @param {number} metricsType
     * @param {number|null} playerId
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} bucketTicks
     * @returns {Promise<MetricsRollupRow[]>}
     * @private
     */
    _queryRollup(metricsType, playerId, fromTick, toTick, bucketTicks) {
        if (this._store === undefined) {
            return Promise.resolve([]);
        }
        return this._store.queryRollup(metricsType, playerId, fromTick, toTick, bucketTicks);
    }

    /**
     * Trims a GLOBAL answer to the rows the type's declaration keeps public (e.g. one side of each trade).
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {MetricsRollupRow[]} rows
     * @returns {MetricsRollupRow[]}
     * @private
     */
    _filterGlobalRows(metricsType, scope, rows) {
        if (scope !== METRICS_QUERY_SCOPE_GLOBAL) {
            return rows;
        }
        const entry = this._modRegistry.metricsGlobalQuery(metricsType);
        if (entry === undefined || entry.rowFilter === null) {
            return rows;
        }
        return rows.filter(entry.rowFilter);
    }

    /**
     * Queries a rollup once and publishes it to every listed session sharing the same params.
     * @param {number[]} sessionIds
     * @param {number} metricsType
     * @param {number} scope
     * @param {number|null} playerId
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} bucketTicks
     * @param {function(): boolean} [isStillValid] - checked after the query resolves; skips publishing if false
     * @private
     */
    _publishRollup(sessionIds, metricsType, scope, playerId, fromTick, toTick, bucketTicks, isStillValid) {
        this._queryRollup(metricsType, playerId, fromTick, toTick, bucketTicks).then(rows => {
            if (isStillValid !== undefined && !isStillValid()) {
                return;
            }
            const compact = compactRollupRows(this._filterGlobalRows(metricsType, scope, rows));
            const event = new MetricsRollupEvent(
                metricsType, scope, bucketTicks, toTick,
                compact.buckets, compact.bucketRowCounts,
                compact.seriesCategory, compact.seriesTag, compact.seriesIndex,
                compact.count, compact.sum,
            );
            for (const sessionId of sessionIds) {
                this._bus.publishTo(sessionId, event);
            }
        }).catch(error => console.error("Metrics rollup query failed:", error));
    }

    /**
     * Queries the single just-completed bucket and publishes it as MetricsRollupBucketEvent; push()'s heartbeat case only.
     * @param {{sessionId: number, windowTicks: number}[]} recipients
     * @param {number} metricsType
     * @param {number} scope
     * @param {number|null} playerId
     * @param {number} bucketTick - the completed bucket's start tick
     * @param {number} eventToTick
     * @param {number} bucketTicks
     * @private
     */
    _publishBucket(recipients, metricsType, scope, playerId, bucketTick, eventToTick, bucketTicks) {
        this._queryRollup(metricsType, playerId, bucketTick, bucketTick + bucketTicks - 1, bucketTicks).then(rows => {
            const filteredRows = this._filterGlobalRows(metricsType, scope, rows);
            const category = filteredRows.map(row => row.category);
            const tag = filteredRows.map(row => row.tag);
            const count = filteredRows.map(row => row.count);
            const sum = filteredRows.map(row => row.sum);
            for (const {sessionId, windowTicks} of recipients) {
                const event = new MetricsRollupBucketEvent(
                    metricsType, scope, bucketTicks, eventToTick, bucketTick, category, tag, count, sum, windowTicks,
                );
                this._bus.publishTo(sessionId, event);
            }
        }).catch(error => console.error("Metrics bucket query failed:", error));
    }
}

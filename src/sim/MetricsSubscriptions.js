import {
    METRICS_EVENT_TYPE_TRADE_EXECUTED, METRICS_QUERY_SCOPE_GLOBAL, METRICS_TRADE_SIDE_SELL, metricsRollupKey,
} from "@/common/MetricsEvent.js";
import {MetricsRollupEvent, MetricsRollupBucketEvent} from "@/common/MetricsQueryEvents.js";

/**
 * One session's live rollup subscription for one (metricsType, scope) key.
 */
class MetricsSubscription {

    /**
     * @param {number} metricsType METRICS_EVENT_TYPE_*
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
 * Drops the non-SELL side so a public price series doesn't double-count each trade.
 * @param {number} metricsType METRICS_EVENT_TYPE_*
 * @param {number} scope METRICS_QUERY_SCOPE_*
 * @param {MetricsRollupRow[]} rows
 * @returns {MetricsRollupRow[]}
 */
function dedupeGlobalTradeRows(metricsType, scope, rows) {
    if (scope !== METRICS_QUERY_SCOPE_GLOBAL || metricsType !== METRICS_EVENT_TYPE_TRADE_EXECUTED) {
        return rows;
    }
    return rows.filter(row => row.tag === METRICS_TRADE_SIDE_SELL);
}

/**
 * Dictionary-encodes flat SQL rows for MetricsRollupEvent's wire shape; assumes rows already grouped by bucket.
 * @param {MetricsRollupRow[]} rows
 * @returns {{buckets: number[], bucketRowCounts: number[], seriesCategory: number[], seriesTag: number[], seriesIndex: number[], count: number[], sum: number[]}}
 */
function compactRows(rows) {
    const buckets = [];
    const bucketRowCounts = [];
    const seriesIndexByKey = new Map();
    const seriesCategory = [];
    const seriesTag = [];
    const seriesIndex = [];
    const count = [];
    const sum = [];
    for (const row of rows) {
        if (buckets.length === 0 || buckets[buckets.length - 1] !== row.bucketTick) {
            buckets.push(row.bucketTick);
            bucketRowCounts.push(0);
        }
        bucketRowCounts[bucketRowCounts.length - 1] += 1;

        const key = `${row.category}:${row.tag}`;
        let index = seriesIndexByKey.get(key);
        if (index === undefined) {
            index = seriesCategory.length;
            seriesIndexByKey.set(key, index);
            seriesCategory.push(row.category);
            seriesTag.push(row.tag);
        }
        seriesIndex.push(index);
        count.push(row.count);
        sum.push(row.sum);
    }
    return {buckets, bucketRowCounts, seriesCategory, seriesTag, seriesIndex, count, sum};
}

/**
 * Serves the metrics query/subscribe/unsubscribe messages and the host's periodic push.
 */
export class MetricsSubscriptions {

    // Takes recorder/bus/engine directly, not a whole Game, to stay testable.
    /**
     * @param {MetricsRecorder} metrics
     * @param {EventBus} bus
     * @param {GameEngine} simEngine
     */
    constructor(metrics, bus, simEngine) {
        this.metrics = metrics;
        this.bus = bus;
        this.simEngine = simEngine;

        /**
         * sessionId -> (metricsRollupKey(metricsType, scope) -> MetricsSubscription).
         * @type {Map<number, Map<number, MetricsSubscription>>}
         * @private
         */
        this._subscriptions = new Map();
    }

    /**
     * OWN forces the requester's own playerId (never client-supplied), GLOBAL is unscoped.
     * @param {AbstractSession} session
     * @param {MetricsRollupRequestMessage} message
     * @returns {void}
     */
    handleRollupRequest(session, message) {
        const playerId = message.scope === METRICS_QUERY_SCOPE_GLOBAL ? null : session.playerId;
        this._publishRollup(
            [session.id], message.metricsType, message.scope, playerId,
            message.fromTick, message.toTick, message.bucketTicks,
        );
    }

    /**
     * Stores the subscription and answers immediately; generation counter guards against out-of-order re-subscribes.
     * @param {AbstractSession} session
     * @param {MetricsSubscribeMessage} message
     * @returns {void}
     */
    handleSubscribe(session, message) {
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

        const playerId = message.scope === METRICS_QUERY_SCOPE_GLOBAL ? null : session.playerId;
        const toTick = this.simEngine.clock;
        const fromTick = Math.max(0, toTick - message.windowTicks);
        this._publishRollup(
            [session.id], message.metricsType, message.scope, playerId, fromTick, toTick, message.bucketTicks,
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
     */
    handleUnsubscribe(session, message) {
        const subs = this._subscriptions.get(session.id);
        if (subs === undefined) {
            return;
        }
        subs.delete(metricsRollupKey(message.metricsType, message.scope));
    }

    /**
     * @param {number} sessionId
     * @returns {void}
     */
    handleDisconnect(sessionId) {
        this._subscriptions.delete(sessionId);
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
        this.metrics.queryRollup(metricsType, playerId, fromTick, toTick, bucketTicks).then(rows => {
            if (isStillValid !== undefined && !isStillValid()) {
                return;
            }
            const compact = compactRows(dedupeGlobalTradeRows(metricsType, scope, rows));
            const event = new MetricsRollupEvent(
                metricsType, scope, bucketTicks, toTick,
                compact.buckets, compact.bucketRowCounts,
                compact.seriesCategory, compact.seriesTag, compact.seriesIndex,
                compact.count, compact.sum,
            );
            for (const sessionId of sessionIds) {
                this.bus.publishTo(sessionId, event);
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
        this.metrics.queryRollup(metricsType, playerId, bucketTick, bucketTick + bucketTicks - 1, bucketTicks).then(rows => {
            const filteredRows = dedupeGlobalTradeRows(metricsType, scope, rows);
            const category = filteredRows.map(row => row.category);
            const tag = filteredRows.map(row => row.tag);
            const count = filteredRows.map(row => row.count);
            const sum = filteredRows.map(row => row.sum);
            for (const {sessionId, windowTicks} of recipients) {
                const event = new MetricsRollupBucketEvent(
                    metricsType, scope, bucketTicks, eventToTick, bucketTick, category, tag, count, sum, windowTicks,
                );
                this.bus.publishTo(sessionId, event);
            }
        }).catch(error => console.error("Metrics bucket query failed:", error));
    }

    /**
     * Pushes every subscription's just-completed bucket, grouped by identical (metricsType, scope, bucketTicks, playerId).
     * @returns {void}
     */
    push() {
        const toTick = this.simEngine.clock;
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
                const playerId = sub.scope === METRICS_QUERY_SCOPE_GLOBAL ? null : this.bus.playerIdOf(sessionId);
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
}

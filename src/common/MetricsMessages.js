import {AbstractMessage} from "@/common/AbstractMessage.js";
import {
    METRICS_EVENT_TYPE_TRADE_EXECUTED, METRICS_QUERY_SCOPE_OWN, METRICS_QUERY_SCOPE_GLOBAL,
} from "@/common/MetricsEvent.js";

// Types any session may query GLOBAL scope; currently just trade history, for the public market price series.
const GLOBAL_QUERYABLE_TYPES = new Set([METRICS_EVENT_TYPE_TRADE_EXECUTED]);

/**
 * Shared by every metrics query message: scope must be known, GLOBAL only for a public type.
 * @param {number} scope METRICS_QUERY_SCOPE_*
 * @param {number} metricsType METRICS_EVENT_TYPE_*
 * @returns {boolean}
 */
function validScope(scope, metricsType) {
    if (scope !== METRICS_QUERY_SCOPE_OWN && scope !== METRICS_QUERY_SCOPE_GLOBAL) {
        return false;
    }
    return scope !== METRICS_QUERY_SCOPE_GLOBAL || GLOBAL_QUERYABLE_TYPES.has(metricsType);
}

/**
 * Requests a bucketed rollup once. See {@link METRICS_QUERY_SCOPE_OWN}/{@link METRICS_QUERY_SCOPE_GLOBAL}.
 */
export class MetricsRollupRequestMessage extends AbstractMessage {

    static wireFields = {
        metricsType: "int32",
        scope: "int32",
        fromTick: "int32",
        toTick: "int32",
        bucketTicks: "int32",
    };

    /**
     * @param {number} metricsType METRICS_EVENT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} bucketTicks
     */
    constructor(metricsType, scope, fromTick, toTick, bucketTicks) {
        super();
        this.metricsType = metricsType;
        this.scope = scope;
        this.fromTick = fromTick;
        this.toTick = toTick;
        this.bucketTicks = bucketTicks;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        if (!validScope(this.scope, this.metricsType)) {
            return false;
        }
        return Number.isInteger(this.fromTick) && Number.isInteger(this.toTick) && this.fromTick <= this.toTick
            && Number.isInteger(this.bucketTicks) && this.bucketTicks > 0;
    }
}

/**
 * Subscribes to a live rollup with a sliding window; re-subscribing with the same (metricsType, scope) replaces the params.
 */
export class MetricsSubscribeMessage extends AbstractMessage {

    static wireFields = {
        metricsType: "int32",
        scope: "int32",
        bucketTicks: "int32",
        windowTicks: "int32",
    };

    /**
     * @param {number} metricsType METRICS_EVENT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} bucketTicks
     * @param {number} windowTicks - how far back from the current tick the sliding window reaches
     */
    constructor(metricsType, scope, bucketTicks, windowTicks) {
        super();
        this.metricsType = metricsType;
        this.scope = scope;
        this.bucketTicks = bucketTicks;
        this.windowTicks = windowTicks;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        if (!validScope(this.scope, this.metricsType)) {
            return false;
        }
        return Number.isInteger(this.bucketTicks) && this.bucketTicks > 0
            && Number.isInteger(this.windowTicks) && this.windowTicks > 0;
    }
}

/**
 * Drops a live subscription; a no-op if none matches (e.g. a closed panel racing a push).
 */
export class MetricsUnsubscribeMessage extends AbstractMessage {

    static wireFields = {
        metricsType: "int32",
        scope: "int32",
    };

    /**
     * @param {number} metricsType METRICS_EVENT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     */
    constructor(metricsType, scope) {
        super();
        this.metricsType = metricsType;
        this.scope = scope;
    }
}

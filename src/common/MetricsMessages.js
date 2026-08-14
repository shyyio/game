import {AbstractMessage} from "@/common/AbstractMessage.js";
import {METRICS_QUERY_SCOPE_OWN, METRICS_QUERY_SCOPE_GLOBAL} from "@/common/MetricsFact.js";
import {MAX_BUCKETS_PER_REQUEST, TIER_LADDER} from "@/common/MetricsTiers.js";

/**
 * An off-ladder tier has no pre-baked buckets, and too wide a span at the finest tier scans facts
 * across the whole range, so both are rejected before a store sees them.
 * @param {number} tier
 * @param {number} spanTicks
 * @returns {boolean}
 */
function validTierSpan(tier, spanTicks) {
    return TIER_LADDER.includes(tier)
        && Number.isInteger(spanTicks) && spanTicks > 0 && spanTicks <= tier * MAX_BUCKETS_PER_REQUEST;
}

/**
 * Shared by every metrics query message: scope must be known, GLOBAL only for a type a mod
 * declared globally queryable.
 * @param {GameAPI} api
 * @param {number} scope METRICS_QUERY_SCOPE_*
 * @param {number} metricsType METRICS_FACT_TYPE_*
 * @returns {boolean}
 */
function validScope(api, scope, metricsType) {
    if (scope !== METRICS_QUERY_SCOPE_OWN && scope !== METRICS_QUERY_SCOPE_GLOBAL) {
        return false;
    }
    return scope !== METRICS_QUERY_SCOPE_GLOBAL || api.modRegistry.metricsGlobalQuery(metricsType) !== undefined;
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
        tier: "int32",
    };

    /**
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} tier
     */
    constructor(metricsType, scope, fromTick, toTick, tier) {
        super();
        this.metricsType = metricsType;
        this.scope = scope;
        this.fromTick = fromTick;
        this.toTick = toTick;
        this.tier = tier;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        if (!validScope(api, this.scope, this.metricsType)) {
            return false;
        }
        return Number.isInteger(this.fromTick) && Number.isInteger(this.toTick) && this.fromTick <= this.toTick
            && validTierSpan(this.tier, this.toTick - this.fromTick + 1);
    }
}

/**
 * Subscribes to a live rollup with a sliding window; re-subscribing with the same (metricsType, scope) replaces the params.
 */
export class MetricsSubscribeMessage extends AbstractMessage {

    static wireFields = {
        metricsType: "int32",
        scope: "int32",
        tier: "int32",
        windowTicks: "int32",
    };

    /**
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} tier
     * @param {number} windowTicks - how far back from the current tick the sliding window reaches
     */
    constructor(metricsType, scope, tier, windowTicks) {
        super();
        this.metricsType = metricsType;
        this.scope = scope;
        this.tier = tier;
        this.windowTicks = windowTicks;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        if (!validScope(api, this.scope, this.metricsType)) {
            return false;
        }
        return validTierSpan(this.tier, this.windowTicks);
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
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     */
    constructor(metricsType, scope) {
        super();
        this.metricsType = metricsType;
        this.scope = scope;
    }
}

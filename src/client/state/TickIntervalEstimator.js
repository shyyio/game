import {DEFAULT_TICK_MS} from "@/common/constants.js";

// Sanity bounds on a per-tick sample; outside them the push gap wasn't a regular heartbeat.
const MIN_SAMPLE_MS = 50;
const MAX_SAMPLE_MS = 5000;
const SMOOTHING = 0.7;

/**
 * Estimates the sim's real-time tick length from the wall-clock gap between live pushes (EMA),
 * until the authoritative TICK_MS setting arrives and pins it.
 */
export class TickIntervalEstimator {

    constructor() {
        this._intervalMs = DEFAULT_TICK_MS;
        this._known = false;
        this._lastPushWallTime = null;
        // A subscribe's immediate reply isn't a regular-cadence push, so it must not feed the EMA.
        this._suppressNextSample = false;
    }

    /**
     * @returns {number}
     */
    get intervalMs() {
        return this._intervalMs;
    }

    /**
     * Wall-clock time of the last recorded push, or null before the first.
     * @returns {number|null}
     */
    get lastPushWallTime() {
        return this._lastPushWallTime;
    }

    /**
     * Pins the estimate to the authoritative value; later samples are ignored.
     * @param {number} tickIntervalMs
     * @returns {void}
     */
    setKnown(tickIntervalMs) {
        this._known = true;
        this._intervalMs = tickIntervalMs;
    }

    /**
     * @returns {void}
     */
    suppressNextSample() {
        this._suppressNextSample = true;
    }

    /**
     * Feeds one push's arrival into the estimate.
     * @param {number} nowMs wall-clock time of the push
     * @param {number} bucketTicks sim ticks the gap since the previous push spans
     * @returns {void}
     */
    recordPush(nowMs, bucketTicks) {
        if (!this._known && this._lastPushWallTime !== null && !this._suppressNextSample) {
            // Raw gap is bucketTicks ticks — divide down to per-tick before feeding the EMA.
            const perTickMs = (nowMs - this._lastPushWallTime) / bucketTicks;
            if (perTickMs > MIN_SAMPLE_MS && perTickMs < MAX_SAMPLE_MS) {
                this._intervalMs = this._intervalMs * SMOOTHING + perTickMs * (1 - SMOOTHING);
            }
        }
        this._suppressNextSample = false;
        this._lastPushWallTime = nowMs;
    }
}

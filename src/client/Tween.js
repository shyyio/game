/**
 * A scalar tween: interpolates a value toward a target over a fixed duration with an easing curve.
 */
export class Tween {

    /**
     * @param {number} value - initial (and settled) value
     * @param {number} durationMs - tween duration
     */
    constructor(value, durationMs) {
        this._duration = durationMs;
        this._value = value;
        this._from = value;
        this._to = value;
        // Elapsed ms into the current tween; at the duration the tween has settled.
        this._elapsed = durationMs;
        this._ease = (t) => t;
    }

    /**
     * @returns {number} the current value
     */
    get value() {
        return this._value;
    }

    /**
     * Snaps to `value` with no in-flight tween.
     * @param {number} value
     * @returns {void}
     */
    reset(value) {
        this._value = value;
        this._from = value;
        this._to = value;
        this._elapsed = this._duration;
    }

    /**
     * Starts a tween from the current value to `target` with the given easing.
     * @param {number} target
     * @param {function(number): number} ease
     * @returns {void}
     */
    to(target, ease) {
        this._from = this._value;
        this._to = target;
        this._ease = ease;
        this._elapsed = 0;
    }

    /**
     * Advances the tween by `deltaMs` and returns the updated value.
     * @param {number} deltaMs
     * @returns {number}
     */
    advance(deltaMs) {
        if (this._elapsed < this._duration) {
            this._elapsed = Math.min(this._elapsed + deltaMs, this._duration);
            this._value = this._from + (this._to - this._from) * this._ease(this._elapsed / this._duration);
        }
        return this._value;
    }
}

// Easing functions over the normalized interval [0, 1].

/**
 * Ease-out-back: decelerates past the target and settles back, overshooting more with a larger `c1`
 * (the standard curve uses 1.70158).
 * @param {number} t
 * @returns {number}
 */
export function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Ease-in-cubic: accelerates from rest, with no overshoot.
 * @param {number} t
 * @returns {number}
 */
export function easeInCubic(t) {
    return t * t * t;
}

// Tween easing functions over the normalized interval [0, 1].

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

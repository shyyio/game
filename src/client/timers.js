/**
 * Runs `callback` every `intervalMs` for the lifetime of the page — a client-side heartbeat. Mods
 * reach this through the SDK instead of `window`, so a bundle never names a page global.
 * @param {number} intervalMs
 * @param {function(): void} callback
 * @returns {void}
 */
export function startHeartbeat(intervalMs, callback) {
    window.setInterval(callback, intervalMs);
}

/**
 * Runs `callback` once, `delayMs` from now, and hands back the way to call it off.
 * @param {number} delayMs
 * @param {function(): void} callback
 * @returns {function(): void} cancels the pending callback; safe to call after it has run
 */
export function startDelay(delayMs, callback) {
    const handle = window.setTimeout(callback, delayMs);
    return () => window.clearTimeout(handle);
}

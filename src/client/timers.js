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

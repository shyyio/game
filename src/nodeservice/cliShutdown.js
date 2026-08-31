/**
 * Wires SIGINT/SIGTERM to a single shutdown callback, guarded against a second signal
 * re-entering it while the first shutdown is still running.
 * @param {(signal: string) => Promise<void>|void} onShutdown
 * @returns {void}
 */
export function bindShutdownSignals(onShutdown) {
    let shuttingDown = false;

    async function shutdown(signal) {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        await onShutdown(signal);
        process.exit(0);
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

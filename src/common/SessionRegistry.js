/**
 * The engine-agnostic session/viewport index: which chunks each session subscribes to, the diff when
 * a viewport changes, and which sessions cover a chunk (for routing events). Plain in-memory state,
 * independent of the simulation backend — replaces the SQL Session/SessionViewport tables and the
 * GetSessionsByChunk lookup.
 */
export class SessionRegistry {

    constructor() {
        // sessionId -> Set<chunk>
        this._viewports = new Map();
    }

    /**
     * Registers a session with an empty viewport.
     * @param {number} sessionId
     * @returns {void}
     */
    add(sessionId) {
        this._viewports.set(sessionId, new Set());
    }

    /**
     * Drops a session and its viewport.
     * @param {number} sessionId
     * @returns {void}
     */
    remove(sessionId) {
        this._viewports.delete(sessionId);
    }

    /**
     * Replaces a session's viewport with `chunks`, returning the delta so the caller syncs only the
     * change (unsubscribe removed chunks, subscribe/seed added ones).
     * @param {number} sessionId
     * @param {number[]} chunks
     * @returns {{added: number[], removed: number[]}}
     */
    setViewport(sessionId, chunks) {
        const current = this._viewports.get(sessionId) === undefined ? new Set() : this._viewports.get(sessionId);
        const requested = new Set(chunks);

        const added = [];
        requested.forEach(chunk => {
            if (!current.has(chunk)) {
                added.push(chunk);
            }
        });
        const removed = [];
        current.forEach(chunk => {
            if (!requested.has(chunk)) {
                removed.push(chunk);
            }
        });

        this._viewports.set(sessionId, requested);
        return {added, removed};
    }

    /**
     * @param {number} sessionId
     * @param {number} chunk
     * @returns {boolean} whether the session's viewport covers the chunk
     */
    covers(sessionId, chunk) {
        const viewport = this._viewports.get(sessionId);
        return viewport !== undefined && viewport.has(chunk);
    }

    /**
     * The ids of the sessions whose viewport covers `chunk`.
     * @param {number} chunk
     * @returns {number[]}
     */
    sessionsForChunk(chunk) {
        const result = [];
        this._viewports.forEach((viewport, sessionId) => {
            if (viewport.has(chunk)) {
                result.push(sessionId);
            }
        });
        return result;
    }
}

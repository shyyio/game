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
        // sessionId -> Set<BigInt> of inspected object ids
        this._inspects = new Map();
    }

    /**
     * Registers a session with an empty viewport and no inspected objects.
     * @param {number} sessionId
     * @returns {void}
     */
    add(sessionId) {
        this._viewports.set(sessionId, new Set());
        this._inspects.set(sessionId, new Set());
    }

    /**
     * Drops a session, its viewport, and its inspect subscriptions.
     * @param {number} sessionId
     * @returns {void}
     */
    remove(sessionId) {
        this._viewports.delete(sessionId);
        this._inspects.delete(sessionId);
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

    /**
     * Replaces a session's inspected-object set with `objectIds`, returning the delta so the caller
     * seeds an immediate snapshot for the newly added objects.
     * @param {number} sessionId
     * @param {BigInt[]} objectIds
     * @returns {{added: BigInt[], removed: BigInt[]}}
     */
    setInspects(sessionId, objectIds) {
        const current = this._inspects.get(sessionId) === undefined ? new Set() : this._inspects.get(sessionId);
        const requested = new Set(objectIds);

        const added = [];
        requested.forEach(objectId => {
            if (!current.has(objectId)) {
                added.push(objectId);
            }
        });
        const removed = [];
        current.forEach(objectId => {
            if (!requested.has(objectId)) {
                removed.push(objectId);
            }
        });

        this._inspects.set(sessionId, requested);
        return {added, removed};
    }

    /**
     * Runs `fn` for each registered session id.
     * @param {function(number): void} fn
     * @returns {void}
     */
    forEachSession(fn) {
        this._inspects.forEach((inspects, sessionId) => fn(sessionId));
    }

    /**
     * The object ids a session is inspecting.
     * @param {number} sessionId
     * @returns {BigInt[]}
     */
    inspects(sessionId) {
        const inspects = this._inspects.get(sessionId);
        return inspects === undefined ? [] : [...inspects];
    }

    /**
     * Stops a session inspecting one object.
     * @param {number} sessionId
     * @param {BigInt} objectId
     * @returns {void}
     */
    removeInspect(sessionId, objectId) {
        const inspects = this._inspects.get(sessionId);
        if (inspects !== undefined) {
            inspects.delete(objectId);
        }
    }

    /**
     * The ids of the sessions inspecting `objectId`.
     * @param {BigInt} objectId
     * @returns {number[]}
     */
    sessionsInspecting(objectId) {
        const result = [];
        this._inspects.forEach((inspects, sessionId) => {
            if (inspects.has(objectId)) {
                result.push(sessionId);
            }
        });
        return result;
    }
}

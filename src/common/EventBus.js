/**
 * Topic pub/sub for session event delivery. A session subscribes to the chunks it views and the
 * objects it inspects; every event is published to its topic's subscribers. This collapses the old
 * broadcast-then-publish split into one `publish`: it picks recipients from the event's own topic and
 * hands each the event, and whether a given session's delivery crosses the wire is that session's own
 * concern. Also allocates session ids and owns the session registry.
 *
 * Chunk and object topics live in separate maps keyed by the raw numeric id, so routing an event
 * builds no string.
 */
export class EventBus {

    constructor() {
        // sessionId -> session
        this._sessions = new Map();
        // chunk -> Set<sessionId>
        this._chunkSubscribers = new Map();
        // objectId -> Set<sessionId>
        this._objectSubscribers = new Map();
        // sessionId -> Set<chunk> (the diff/query source for viewport topics)
        this._viewports = new Map();
        // sessionId -> Set<objectId> (the diff/query source for inspect topics)
        this._inspects = new Map();
        this._nextId = 1;
    }

    // ---- Sessions ----

    /**
     * Allocates a session id, registers the session, and gives it an empty viewport / inspect set.
     * @param {AbstractSession} session
     * @returns {number} the new session id
     */
    addSession(session) {
        const sessionId = this._nextId;
        this._nextId += 1;
        this._sessions.set(sessionId, session);
        this._viewports.set(sessionId, new Set());
        this._inspects.set(sessionId, new Set());
        return sessionId;
    }

    /**
     * Drops a session, unsubscribing it from every chunk and object topic.
     * @param {number} sessionId
     * @returns {void}
     */
    removeSession(sessionId) {
        for (const chunk of this._viewports.get(sessionId)) {
            this._unsubscribe(this._chunkSubscribers, chunk, sessionId);
        }
        for (const objectId of this._inspects.get(sessionId)) {
            this._unsubscribe(this._objectSubscribers, objectId, sessionId);
        }
        this._viewports.delete(sessionId);
        this._inspects.delete(sessionId);
        this._sessions.delete(sessionId);
    }

    // ---- Delivery ----

    /**
     * Fans an event to every session subscribed to its topic.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publish(event) {
        const subscribers = event.subscribersIn(this);
        if (subscribers === undefined) {
            return;
        }
        // Copied: a session's own dispatch may resubscribe while we fan out.
        for (const sessionId of [...subscribers]) {
            this._sessions.get(sessionId).publishEvent(event);
        }
    }

    /**
     * The sessions viewing a chunk, or undefined when none.
     * @param {number} chunk
     * @returns {Set<number>|undefined}
     */
    chunkSubscribers(chunk) {
        return this._chunkSubscribers.get(chunk);
    }

    /**
     * The sessions inspecting an object, or undefined when none.
     * @param {number} objectId
     * @returns {Set<number>|undefined}
     */
    objectSubscribers(objectId) {
        return this._objectSubscribers.get(objectId);
    }

    /**
     * Whether any session is subscribed to a chunk's topic. The sim checks this before building a
     * render event, so an unwatched chunk costs nothing.
     * @param {number} chunk
     * @returns {boolean}
     */
    hasChunkSubscribers(chunk) {
        return this._chunkSubscribers.has(chunk);
    }

    /**
     * Delivers an event to one session (a subscribe/sync or seed, targeted at that session alone).
     * @param {number} sessionId
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publishTo(sessionId, event) {
        const session = this._sessions.get(sessionId);
        if (session !== undefined) {
            session.publishEvent(event);
        }
    }

    // ---- Viewport topics ----

    /**
     * Replaces a session's viewport with `chunks`, subscribing/unsubscribing chunk topics and returning
     * the delta so the caller syncs only the change.
     * @param {number} sessionId
     * @param {number[]} chunks
     * @returns {{added: number[], removed: number[]}}
     */
    setViewport(sessionId, chunks) {
        const current = this._viewports.get(sessionId);
        const requested = new Set(chunks);

        const added = [];
        for (const chunk of requested) {
            if (!current.has(chunk)) {
                added.push(chunk);
                this._subscribe(this._chunkSubscribers, chunk, sessionId);
            }
        }
        const removed = [];
        for (const chunk of current) {
            if (!requested.has(chunk)) {
                removed.push(chunk);
                this._unsubscribe(this._chunkSubscribers, chunk, sessionId);
            }
        }

        this._viewports.set(sessionId, requested);
        return {added, removed};
    }

    // ---- Inspect topics ----

    /**
     * Replaces a session's inspected-object set with `objectIds`, subscribing/unsubscribing object
     * topics and returning the delta so the caller seeds a snapshot for the added objects.
     * @param {number} sessionId
     * @param {number[]} objectIds
     * @returns {{added: number[], removed: number[]}}
     */
    setInspects(sessionId, objectIds) {
        const current = this._inspects.get(sessionId);
        const requested = new Set(objectIds);

        const added = [];
        for (const objectId of requested) {
            if (!current.has(objectId)) {
                added.push(objectId);
                this._subscribe(this._objectSubscribers, objectId, sessionId);
            }
        }
        const removed = [];
        for (const objectId of current) {
            if (!requested.has(objectId)) {
                removed.push(objectId);
                this._unsubscribe(this._objectSubscribers, objectId, sessionId);
            }
        }

        this._inspects.set(sessionId, requested);
        return {added, removed};
    }

    /**
     * The ids of every object at least one session is inspecting.
     * @returns {number[]}
     */
    subscribedObjects() {
        const objectIds = new Set();
        for (const inspects of this._inspects.values()) {
            for (const objectId of inspects) {
                objectIds.add(objectId);
            }
        }
        return [...objectIds];
    }

    /**
     * Drops every subscription to an object's topic (its object is gone), so no session inspects it.
     * @param {number} objectId
     * @returns {void}
     */
    clearObject(objectId) {
        const subscribers = this._objectSubscribers.get(objectId);
        if (subscribers === undefined) {
            return;
        }
        for (const sessionId of subscribers) {
            this._inspects.get(sessionId).delete(objectId);
        }
        this._objectSubscribers.delete(objectId);
    }

    // ---- Subscriptions ----

    /**
     * @private
     * @param {Map<number, Set<number>>} topics
     * @param {number} key
     * @param {number} sessionId
     * @returns {void}
     */
    _subscribe(topics, key, sessionId) {
        let subscribers = topics.get(key);
        if (subscribers === undefined) {
            subscribers = new Set();
            topics.set(key, subscribers);
        }
        subscribers.add(sessionId);
    }

    /**
     * @private
     * @param {Map<number, Set<number>>} topics
     * @param {number} key
     * @param {number} sessionId
     * @returns {void}
     */
    _unsubscribe(topics, key, sessionId) {
        const subscribers = topics.get(key);
        if (subscribers === undefined) {
            return;
        }
        subscribers.delete(sessionId);
        if (subscribers.size === 0) {
            topics.delete(key);
        }
    }
}

/**
 * Topic pub/sub for session event delivery. A session subscribes to the chunks it views and the
 * objects it inspects; `publish` picks recipients from the event's own topic and hands each the
 * event, and whether a given session's delivery crosses the wire is that session's own concern.
 * Also allocates session refs and owns the session registry.
 *
 * Chunk and object topics live in separate maps keyed by the raw numeric id, so routing an event
 * builds no string.
 */
export class EventBus {

    constructor() {
        // sessionRef -> session
        this._sessions = new Map();
        // chunk -> Set<sessionRef>
        this._chunkSubscribers = new Map();
        // objectRef -> Set<sessionRef>
        this._objectSubscribers = new Map();
        // sessionRef -> Set<chunk> (the diff/query source for viewport topics)
        this._viewports = new Map();
        // sessionRef -> Set<objectRef> (the diff/query source for inspect topics)
        this._inspects = new Map();
        this._nextId = 1;
    }

    /**
     * Allocates a session ref, registers the session, and gives it an empty viewport / inspect set.
     * @param {AbstractSession} session
     * @returns {number} the new session ref
     */
    addSession(session) {
        const sessionRef = this._nextId;
        this._nextId += 1;
        this._sessions.set(sessionRef, session);
        this._viewports.set(sessionRef, new Set());
        this._inspects.set(sessionRef, new Set());
        return sessionRef;
    }

    /**
     * Drops a session, unsubscribing it from every chunk and object topic.
     * @param {number} sessionRef
     * @returns {void}
     */
    removeSession(sessionRef) {
        for (const chunk of this._viewports.get(sessionRef)) {
            this._unsubscribe(this._chunkSubscribers, chunk, sessionRef);
        }
        for (const objectRef of this._inspects.get(sessionRef)) {
            this._unsubscribe(this._objectSubscribers, objectRef, sessionRef);
        }
        this._viewports.delete(sessionRef);
        this._inspects.delete(sessionRef);
        this._sessions.delete(sessionRef);
    }

    /**
     * Fans an event to every session subscribed to its topic.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publish(event) {
        const subscribers = event.getSubscribersByBus(this);
        if (subscribers === undefined) {
            return;
        }
        // Copied: a session's own dispatch may resubscribe while we fan out.
        for (const sessionRef of Array.from(subscribers)) {
            this._sessions.get(sessionRef).publishEvent(event);
        }
    }

    /**
     * Delivers an event to every connected session, subscribed to anything or not. Reserved for
     * what every client needs whatever it is looking at — the tick heartbeat.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publishToAll(event) {
        for (const session of this._sessions.values()) {
            session.publishEvent(event);
        }
    }

    /**
     * The connected sessions of one player (targeted per-player resyncs route through this).
     * @param {number} playerRef
     * @returns {number[]}
     */
    getSessionRefsByPlayerRef(playerRef) {
        const ids = [];
        for (const [sessionRef, session] of this._sessions) {
            if (session.playerRef === playerRef) {
                ids.push(sessionRef);
            }
        }
        return ids;
    }

    /**
     * Delivers an event to every connected session of one player.
     * @param {number} playerRef
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publishToPlayer(playerRef, event) {
        for (const session of this._sessions.values()) {
            if (session.playerRef === playerRef) {
                session.publishEvent(event);
            }
        }
    }

    /**
     * The player behind a connected session.
     * @param {number} sessionRef
     * @returns {number}
     */
    getPlayerRefBySessionRef(sessionRef) {
        const session = this._sessions.get(sessionRef);
        if (session === undefined) {
            throw new RangeError(`Unknown sessionRef: ${sessionRef}`);
        }
        return session.playerRef;
    }

    /**
     * The sessions viewing a chunk, or undefined when none.
     * @param {number} chunkKey
     * @returns {Set<number>|undefined}
     */
    findSubscribersByChunkKey(chunkKey) {
        return this._chunkSubscribers.get(chunkKey);
    }

    /**
     * The sessions inspecting an object, or undefined when none.
     * @param {number} objectRef
     * @returns {Set<number>|undefined}
     */
    findSubscribersByObjectRef(objectRef) {
        return this._objectSubscribers.get(objectRef);
    }

    /**
     * Whether any session is subscribed to a chunk's topic. The sim checks this before building a
     * render event, so an unwatched chunk costs nothing.
     * @param {number} chunkKey
     * @returns {boolean}
     */
    hasChunkSubscribers(chunkKey) {
        return this._chunkSubscribers.has(chunkKey);
    }

    /**
     * Delivers an event to one session (a subscribe/sync or seed, targeted at that session alone).
     * @param {number} sessionRef
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publishTo(sessionRef, event) {
        const session = this._sessions.get(sessionRef);
        if (session !== undefined) {
            session.publishEvent(event);
        }
    }

    /**
     * Replaces a session's viewport with `chunks`, subscribing/unsubscribing chunk topics and returning
     * the delta so the caller syncs only the change.
     * @param {number} sessionRef
     * @param {number[]} chunks
     * @returns {{added: number[], removed: number[]}}
     */
    setViewport(sessionRef, chunks) {
        const current = this._viewports.get(sessionRef);
        const requested = new Set(chunks);

        const added = [];
        for (const chunk of requested) {
            if (!current.has(chunk)) {
                added.push(chunk);
                this._subscribe(this._chunkSubscribers, chunk, sessionRef);
            }
        }
        const removed = [];
        for (const chunk of current) {
            if (!requested.has(chunk)) {
                removed.push(chunk);
                this._unsubscribe(this._chunkSubscribers, chunk, sessionRef);
            }
        }

        this._viewports.set(sessionRef, requested);
        return {added, removed};
    }

    /**
     * Replaces a session's inspected-object set with `objectRefs`, subscribing/unsubscribing object
     * topics and returning the delta so the caller seeds a snapshot for the added objects.
     * @param {number} sessionRef
     * @param {number[]} objectRefs
     * @returns {{added: number[], removed: number[]}}
     */
    setInspects(sessionRef, objectRefs) {
        const current = this._inspects.get(sessionRef);
        const requested = new Set(objectRefs);

        const added = [];
        for (const objectRef of requested) {
            if (!current.has(objectRef)) {
                added.push(objectRef);
                this._subscribe(this._objectSubscribers, objectRef, sessionRef);
            }
        }
        const removed = [];
        for (const objectRef of current) {
            if (!requested.has(objectRef)) {
                removed.push(objectRef);
                this._unsubscribe(this._objectSubscribers, objectRef, sessionRef);
            }
        }

        this._inspects.set(sessionRef, requested);
        return {added, removed};
    }

    /**
     * The ids of every object at least one session is inspecting.
     * @returns {number[]}
     */
    getSubscribedObjectRefs() {
        const objectRefs = new Set();
        for (const inspects of this._inspects.values()) {
            for (const objectRef of inspects) {
                objectRefs.add(objectRef);
            }
        }
        return Array.from(objectRefs);
    }

    /**
     * Drops every subscription to an object's topic (its object is gone), so no session inspects it.
     * @param {number} objectRef
     * @returns {void}
     */
    clearObject(objectRef) {
        const subscribers = this._objectSubscribers.get(objectRef);
        if (subscribers === undefined) {
            return;
        }
        for (const sessionRef of subscribers) {
            this._inspects.get(sessionRef).delete(objectRef);
        }
        this._objectSubscribers.delete(objectRef);
    }

    /**
     * @private
     * @param {Map<number, Set<number>>} topics
     * @param {number} key
     * @param {number} sessionRef
     * @returns {void}
     */
    _subscribe(topics, key, sessionRef) {
        let subscribers = topics.get(key);
        if (subscribers === undefined) {
            subscribers = new Set();
            topics.set(key, subscribers);
        }
        subscribers.add(sessionRef);
    }

    /**
     * @private
     * @param {Map<number, Set<number>>} topics
     * @param {number} key
     * @param {number} sessionRef
     * @returns {void}
     */
    _unsubscribe(topics, key, sessionRef) {
        const subscribers = topics.get(key);
        if (subscribers === undefined) {
            return;
        }
        subscribers.delete(sessionRef);
        if (subscribers.size === 0) {
            topics.delete(key);
        }
    }
}

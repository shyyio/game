import {chunkTopic, objectTopic} from "@/common/topics.js";

/**
 * Topic pub/sub for session event delivery. A session subscribes to the chunks it views and the
 * objects it inspects; every event is published to its topic's subscribers. This collapses the old
 * broadcast-then-publish split into one `publish`: it picks recipients from the event's own topic and
 * hands each the event, and whether a given session's delivery crosses the wire is that session's own
 * concern. Also allocates session ids and owns the session registry.
 */
export class EventBus {

    constructor() {
        // sessionId -> session
        this._sessions = new Map();
        // topicKey -> Set<sessionId>
        this._subscribers = new Map();
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
        this._viewports.get(sessionId).forEach(chunk => this._unsubscribe(chunkTopic(chunk), sessionId));
        this._inspects.get(sessionId).forEach(objectId => this._unsubscribe(objectTopic(objectId), sessionId));
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
        const subscribers = this._subscribers.get(event.topicKey);
        if (subscribers === undefined) {
            return;
        }
        subscribers.forEach(sessionId => {
            this._sessions.get(sessionId).publishEvent(event);
        });
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
        requested.forEach(chunk => {
            if (!current.has(chunk)) {
                added.push(chunk);
                this._subscribe(chunkTopic(chunk), sessionId);
            }
        });
        const removed = [];
        current.forEach(chunk => {
            if (!requested.has(chunk)) {
                removed.push(chunk);
                this._unsubscribe(chunkTopic(chunk), sessionId);
            }
        });

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
        requested.forEach(objectId => {
            if (!current.has(objectId)) {
                added.push(objectId);
                this._subscribe(objectTopic(objectId), sessionId);
            }
        });
        const removed = [];
        current.forEach(objectId => {
            if (!requested.has(objectId)) {
                removed.push(objectId);
                this._unsubscribe(objectTopic(objectId), sessionId);
            }
        });

        this._inspects.set(sessionId, requested);
        return {added, removed};
    }

    /**
     * The ids of every object at least one session is inspecting.
     * @returns {number[]}
     */
    subscribedObjects() {
        const objectIds = new Set();
        this._inspects.forEach(inspects => inspects.forEach(objectId => objectIds.add(objectId)));
        return [...objectIds];
    }

    /**
     * Drops every subscription to an object's topic (its object is gone), so no session inspects it.
     * @param {number} objectId
     * @returns {void}
     */
    clearObject(objectId) {
        const subscribers = this._subscribers.get(objectTopic(objectId));
        if (subscribers === undefined) {
            return;
        }
        subscribers.forEach(sessionId => this._inspects.get(sessionId).delete(objectId));
        this._subscribers.delete(objectTopic(objectId));
    }

    // ---- Subscriptions ----

    /**
     * @private
     * @param {string} topicKey
     * @param {number} sessionId
     * @returns {void}
     */
    _subscribe(topicKey, sessionId) {
        let subscribers = this._subscribers.get(topicKey);
        if (subscribers === undefined) {
            subscribers = new Set();
            this._subscribers.set(topicKey, subscribers);
        }
        subscribers.add(sessionId);
    }

    /**
     * @private
     * @param {string} topicKey
     * @param {number} sessionId
     * @returns {void}
     */
    _unsubscribe(topicKey, sessionId) {
        const subscribers = this._subscribers.get(topicKey);
        if (subscribers === undefined) {
            return;
        }
        subscribers.delete(sessionId);
        if (subscribers.size === 0) {
            this._subscribers.delete(topicKey);
        }
    }
}

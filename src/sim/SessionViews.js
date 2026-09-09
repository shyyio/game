import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {InspectClosedEvent} from "@/common/InspectEvents.js";
import {ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {PLAYER_REF_NONE} from "@/common/constants.js";

/**
 * What each session is currently looking at: the chunks in its viewport, the overworld map it
 * requests, and the objects it has inspect menus open on.
 */
export class SessionViews {

    /**
     * @param {Game} game
     */
    constructor(game) {
        this.game = game;
    }

    /**
     * Diffs the session's viewport against the requested chunks so a pan only syncs the delta.
     * @param {AbstractSession} session
     * @param {number[]} chunks
     * @returns {void}
     */
    setViewport(session, chunks) {
        const {added, removed} = this.game.bus.setViewport(session.sessionRef, chunks);
        if (added.length > 0 || removed.length > 0) {
            this.game.simEngine.invalidateObservers();
        }

        for (const chunk of removed) {
            this.game.bus.publishTo(session.sessionRef, new ChunkUnsubscribeEvent(chunk));
        }

        for (const chunk of added) {
            this.game.bus.publishTo(session.sessionRef, new ChunkSubscribeEvent(chunk));

            // Seed the chunk's claim (the client evicted it on unsubscribe), owner name first.
            const owner = this.game.claims.ownerOf(chunk);
            if (owner !== PLAYER_REF_NONE) {
                this.game.playerDirectory.syncUsernames(session.sessionRef, [owner]);
                const permission = this.game.claims.permissionOf(chunk);
                this.game.bus.publishTo(session.sessionRef, new ChunkClaimUpdateEvent(chunk, owner, permission));
            }

            // Before the bundle, so a mod's own per-chunk sync lands ahead of it.
            for (const mod of this.game.modRegistry.simMods) {
                mod.onChunkSubscribed(session, chunk, this.game);
            }

            // Bundle the chunk's recreate events into one ChunkSyncEvent; the client unwraps it.
            const events = this.game.simEngine.chunkSync(chunk);
            if (events.length > 0) {
                this.game.bus.publishTo(session.sessionRef, new ChunkSyncEvent(chunk, events));
            }
        }
    }

    /**
     * Answers an overworld request from the hot bake, straight to the asking session.
     * @param {AbstractSession} session
     * @param {OverworldRequestMessage} message
     * @returns {void}
     */
    sendOverworldSnapshot(session, message) {
        const snapshot = this.game.simEngine.overworldBake.snapshot(
            message.chunkX,
            message.chunkY,
            message.chunkWidth,
            message.chunkHeight,
        );
        // The bake knows tiles only; claims join here, owner names first so labels resolve.
        const claims = this.game.claims.claimsIn(
            message.chunkX,
            message.chunkY,
            message.chunkWidth,
            message.chunkHeight,
        );
        this.game.playerDirectory.syncUsernames(session.sessionRef, claims.playerRefs);
        snapshot.claimedChunks = claims.chunks;
        snapshot.claimOwners = claims.playerRefs;
        snapshot.claimPermissions = claims.permissions;
        this.game.bus.publishTo(session.sessionRef, snapshot);
    }

    /**
     * Diffs the session's inspected-object set against the requested ids.
     * @param {AbstractSession} session
     * @param {number[]} objectRefs
     * @returns {void}
     */
    setInspects(session, objectRefs) {
        const {added} = this.game.bus.setInspects(session.sessionRef, objectRefs);
        // Fill each new menu now, not on the next heartbeat.
        for (const objectRef of added) {
            this._syncInspect(session, objectRef);
        }
    }

    /**
     * Sends a session one object's current snapshot when its menu opens.
     * @private
     * @param {AbstractSession} session
     * @param {number} objectRef
     * @returns {void}
     */
    _syncInspect(session, objectRef) {
        const snapshot = this.game.simEngine.inspectSnapshot(objectRef);
        if (snapshot !== null) {
            this.game.bus.publishTo(session.sessionRef, snapshot);
        }
    }

    /**
     * Closes a deleted object's menu on every session inspecting it, then drops its subscriptions.
     * @param {number} objectRef
     * @returns {void}
     */
    closeInspect(objectRef) {
        this.game.bus.publish(new InspectClosedEvent(objectRef));
        this.game.bus.clearObject(objectRef);
    }

    /**
     * Publishes this tick's snapshot of every inspected object to its topic (fanning to all sessions
     * inspecting it), closing menus for any object that has since been removed.
     * @returns {void}
     */
    dispatchInspectEvents() {
        for (const objectRef of this.game.bus.subscribedObjects()) {
            const snapshot = this.game.simEngine.inspectSnapshot(objectRef);
            if (snapshot === null) {
                this.closeInspect(objectRef);
                continue;
            }
            this.game.bus.publish(snapshot);
        }
    }
}

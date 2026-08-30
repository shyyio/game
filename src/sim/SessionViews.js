import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {InspectClosedEvent} from "@/common/InspectEvents.js";
import {ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";

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
        const {added, removed} = this.game.bus.setViewport(session.id, chunks);
        if (added.length > 0 || removed.length > 0) {
            this.game.simEngine.invalidateObservers();
        }

        for (const chunk of removed) {
            this.game.bus.publishTo(session.id, new ChunkUnsubscribeEvent(chunk));
        }

        for (const chunk of added) {
            this.game.bus.publishTo(session.id, new ChunkSubscribeEvent(chunk));

            // Seed the chunk's claim (the client evicted it on unsubscribe), owner name first.
            const owner = this.game.claims.ownerOf(chunk);
            if (owner !== PLAYER_ID_NONE) {
                this.game.playerDirectory.syncUsernames(session.id, [owner]);
                const permission = this.game.claims.permissionOf(chunk);
                this.game.bus.publishTo(session.id, new ChunkClaimUpdateEvent(chunk, owner, permission));
            }

            // Before the bundle, so a mod's own per-chunk sync lands ahead of it.
            for (const mod of this.game.modRegistry.simMods) {
                mod.onChunkSubscribed(session, chunk, this.game);
            }

            // Bundle the chunk's recreate events into one ChunkSyncEvent; the client unwraps it.
            const events = this.game.simEngine.chunkSync(chunk);
            if (events.length > 0) {
                this.game.bus.publishTo(session.id, new ChunkSyncEvent(chunk, events));
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
        this.game.playerDirectory.syncUsernames(session.id, claims.playerIds);
        snapshot.claimedChunks = claims.chunks;
        snapshot.claimOwners = claims.playerIds;
        snapshot.claimPermissions = claims.permissions;
        this.game.bus.publishTo(session.id, snapshot);
    }

    /**
     * Diffs the session's inspected-object set against the requested ids.
     * @param {AbstractSession} session
     * @param {number[]} objectIds
     * @returns {void}
     */
    setInspects(session, objectIds) {
        const {added} = this.game.bus.setInspects(session.id, objectIds);
        // Fill each new menu now, not on the next heartbeat.
        for (const objectId of added) {
            this._syncInspect(session, objectId);
        }
    }

    /**
     * Sends a session one object's current snapshot when its menu opens.
     * @private
     * @param {AbstractSession} session
     * @param {number} objectId
     * @returns {void}
     */
    _syncInspect(session, objectId) {
        const snapshot = this.game.simEngine.inspectSnapshot(objectId);
        if (snapshot !== null) {
            this.game.bus.publishTo(session.id, snapshot);
        }
    }

    /**
     * Closes a deleted object's menu on every session inspecting it, then drops its subscriptions.
     * @param {number} objectId
     * @returns {void}
     */
    closeInspect(objectId) {
        this.game.bus.publish(new InspectClosedEvent(objectId));
        this.game.bus.clearObject(objectId);
    }

    /**
     * Publishes this tick's snapshot of every inspected object to its topic (fanning to all sessions
     * inspecting it), closing menus for any object that has since been removed.
     * @returns {void}
     */
    dispatchInspectEvents() {
        for (const objectId of this.game.bus.subscribedObjects()) {
            const snapshot = this.game.simEngine.inspectSnapshot(objectId);
            if (snapshot === null) {
                this.closeInspect(objectId);
                continue;
            }
            this.game.bus.publish(snapshot);
        }
    }
}

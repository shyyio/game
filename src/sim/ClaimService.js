import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectSyncEvent} from "@/common/ObjectEvents.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {
    OwnClaimsSyncEvent, ChunkClaimUpdateEvent, ClaimResultEvent, ClaimResult, ChunkPermission,
} from "@/common/ClaimEvents.js";
import {PLAYER_REF_NONE} from "@/common/constants.js";

/**
 * The chunk claim requests a session can make: claim, unclaim, and permission changes.
 */
export class ClaimService {

    /**
     * @param {Game} game
     */
    constructor(game) {
        this.game = game;
    }

    /**
     * Sends a fresh session its own claims and their permissions.
     * @param {AbstractSession} session
     * @returns {void}
     */
    syncOwnClaims(session) {
        const ownChunks = Array.from(this.game.claims.getChunkKeysByPlayerRef(session.playerRef));
        const ownPermissions = ownChunks.map(chunk => this.game.claims.getPermissionByChunkKey(chunk));
        this.game.bus.publishTo(session.sessionRef, new OwnClaimsSyncEvent(ownChunks, ownPermissions));
    }

    /**
     * @param {AbstractSession} session
     * @param {number} chunkKey
     * @returns {void}
     */
    claim(session, chunkKey) {
        const entry = this.game.players.getPlayerByRef(session.playerRef);
        const result = this.game.claims.claim(session.playerRef, chunkKey, entry.maxChunks);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            this._publishChunkClaimUpdate(session, chunkKey, session.playerRef, this.game.claims.getPermissionByChunkKey(chunkKey));
        }
        this.game.bus.publishTo(session.sessionRef, new ClaimResultEvent(chunkKey, result));
    }

    /**
     * Sets a claimed chunk's permission; silently ignored if the sender does not own it (a stale
     * panel racing a concurrent unclaim), same as any other invariant the client already gates on.
     * @param {AbstractSession} session
     * @param {number} chunkKey
     * @param {number} permission - a ChunkPermission
     * @returns {void}
     */
    setPermission(session, chunkKey, permission) {
        const result = this.game.claims.setPermission(session.playerRef, chunkKey, permission);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            this._publishChunkClaimUpdate(session, chunkKey, session.playerRef, permission);
        }
    }

    /**
     * @param {AbstractSession} session
     * @param {number} chunkKey
     * @param {boolean} clear - whether the player confirmed emptying the chunk
     * @returns {void}
     */
    unclaim(session, chunkKey, clear) {
        // A doomed unclaim (not owner, would split) rejects before the not-empty confirmation.
        const check = this.game.claims.unclaimCheck(session.playerRef, chunkKey);
        if (check !== ClaimResult.CLAIM_RESULT_OK) {
            this.game.bus.publishTo(session.sessionRef, new ClaimResultEvent(chunkKey, check));
            return;
        }
        const solidIds = this._getSolidObjectRefsByChunkKey(chunkKey);
        // An unclaim must empty the chunk; without the clear confirmation it is rejected.
        if (solidIds.length > 0 && !clear) {
            this.game.bus.publishTo(session.sessionRef, new ClaimResultEvent(chunkKey, ClaimResult.CLAIM_RESULT_NOT_EMPTY));
            return;
        }
        const result = this.game.claims.unclaim(session.playerRef, chunkKey);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            // Engine-originated deletes bypass the placement gate the now-unclaimed chunk holds.
            for (const objectRef of solidIds) {
                this.game.simEngine.applyMessage(new DeleteObjectMessage(objectRef), PLAYER_REF_NONE);
            }
            this._publishChunkClaimUpdate(session, chunkKey, PLAYER_REF_NONE, ChunkPermission.PERMISSION_FRIENDS);
        }
        this.game.bus.publishTo(session.sessionRef, new ClaimResultEvent(chunkKey, result));
    }

    /**
     * Publishes a claim change to the chunk's viewers (owner name first, so the label resolves)
     * and targets it at the acting player's remaining sessions, which track their own claims
     * everywhere.
     * @private
     * @param {AbstractSession} session
     * @param {number} chunkKey
     * @param {number} owner - the new owner, or PLAYER_REF_NONE for an unclaim
     * @param {number} permission - the chunk's ChunkPermission; meaningless for an unclaim
     * @returns {void}
     */
    _publishChunkClaimUpdate(session, chunkKey, owner, permission) {
        const event = new ChunkClaimUpdateEvent(chunkKey, owner, permission);
        const subscribers = this.game.bus.getSubscribersByChunkKey(chunkKey);
        for (const sessionRef of subscribers) {
            this.game.playerDirectory.syncUsernames(sessionRef, [owner]);
        }
        this.game.bus.publish(event);
        for (const sessionRef of this.game.bus.getSessionRefsByPlayerRef(session.playerRef)) {
            if (!subscribers.has(sessionRef)) {
                this.game.bus.publishTo(sessionRef, event);
            }
        }
    }

    /**
     * The object refs of every solid object in a chunk; non-solid ground cover
     * (resources, water) stays out.
     * @private
     * @param {number} chunkKey
     * @returns {number[]}
     */
    _getSolidObjectRefsByChunkKey(chunkKey) {
        const ids = [];
        for (const event of this.game.simEngine.chunkSync(chunkKey)) {
            let inner = [event];
            if (event instanceof AbstractBatchEvent) {
                inner = event.explode();
            }
            for (const single of inner) {
                if (!(single instanceof ObjectSyncEvent)) {
                    continue;
                }
                const type = this.game.modRegistry.getObjectTypeByTypeId(single.objectTypeId);
                if (type.placement.solid) {
                    ids.push(single.objectRef);
                }
            }
        }
        return ids;
    }
}

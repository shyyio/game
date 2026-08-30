import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectSyncEvent} from "@/common/ObjectEvents.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {
    OwnClaimsSyncEvent, ChunkClaimUpdateEvent, ClaimResultEvent, ClaimResult, ChunkPermission,
} from "@/common/ClaimEvents.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";

/**
 * The chunk claim requests a session can make: claim, unclaim, and permission changes, plus the
 * build rights the engine's placement gate reads off them.
 */
export class ClaimAdmin {

    /**
     * @param {Game} game
     */
    constructor(game) {
        this.game = game;
    }

    /**
     * Whether a player may modify a chunk: the owner always may; unclaimed is off limits;
     * everyone else is gated by the chunk's permission. Mirrored client-side by
     * ChunkClaimsView.canBuildIn; keep both in sync.
     * @param {number} playerId
     * @param {number} chunk
     * @returns {boolean}
     */
    canBuildIn(playerId, chunk) {
        const owner = this.game.claims.ownerOf(chunk);
        if (owner === PLAYER_ID_NONE) {
            return false;
        }
        if (owner === playerId) {
            return true;
        }
        if (this.game.claims.permissionOf(chunk) === ChunkPermission.PERMISSION_ONLY_ME) {
            return false;
        }
        return this.game.players.isFriend(owner, playerId);
    }

    /**
     * Sends a fresh session its own claims and their permissions.
     * @param {AbstractSession} session
     * @returns {void}
     */
    syncOwnClaims(session) {
        const ownChunks = [...this.game.claims.chunksOf(session.playerId)];
        const ownPermissions = ownChunks.map(chunk => this.game.claims.permissionOf(chunk));
        this.game.bus.publishTo(session.id, new OwnClaimsSyncEvent(ownChunks, ownPermissions));
    }

    /**
     * @param {AbstractSession} session
     * @param {number} chunk
     * @returns {void}
     */
    claim(session, chunk) {
        const record = this.game.players.byId(session.playerId);
        const result = this.game.claims.claim(session.playerId, chunk, record.maxChunks);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            this._publishUpdate(session, chunk, session.playerId, this.game.claims.permissionOf(chunk));
        }
        this.game.bus.publishTo(session.id, new ClaimResultEvent(chunk, result));
    }

    /**
     * Sets a claimed chunk's permission; silently ignored if the sender does not own it (a stale
     * panel racing a concurrent unclaim), same as any other invariant the client already gates on.
     * @param {AbstractSession} session
     * @param {number} chunk
     * @param {number} permission - a ChunkPermission
     * @returns {void}
     */
    setPermission(session, chunk, permission) {
        const result = this.game.claims.setPermission(session.playerId, chunk, permission);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            this._publishUpdate(session, chunk, session.playerId, permission);
        }
    }

    /**
     * @param {AbstractSession} session
     * @param {number} chunk
     * @param {boolean} clear - whether the player confirmed emptying the chunk
     * @returns {void}
     */
    unclaim(session, chunk, clear) {
        // A doomed unclaim (not owner, would split) rejects before the not-empty confirmation.
        const check = this.game.claims.unclaimCheck(session.playerId, chunk);
        if (check !== ClaimResult.CLAIM_RESULT_OK) {
            this.game.bus.publishTo(session.id, new ClaimResultEvent(chunk, check));
            return;
        }
        const solidIds = this._solidObjectIdsIn(chunk);
        // An unclaim must empty the chunk; without the clear confirmation it is rejected.
        if (solidIds.length > 0 && !clear) {
            this.game.bus.publishTo(session.id, new ClaimResultEvent(chunk, ClaimResult.CLAIM_RESULT_NOT_EMPTY));
            return;
        }
        const result = this.game.claims.unclaim(session.playerId, chunk);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            // Engine-originated deletes bypass the placement gate the now-unclaimed chunk holds.
            for (const objectId of solidIds) {
                this.game.simEngine.applyMessage(new DeleteObjectMessage(objectId), PLAYER_ID_NONE);
            }
            this._publishUpdate(session, chunk, PLAYER_ID_NONE, ChunkPermission.PERMISSION_FRIENDS);
        }
        this.game.bus.publishTo(session.id, new ClaimResultEvent(chunk, result));
    }

    /**
     * Publishes a claim change to the chunk's viewers (owner name first, so the label resolves)
     * and targets it at the acting player's remaining sessions, which track their own claims
     * everywhere.
     * @private
     * @param {AbstractSession} session
     * @param {number} chunk
     * @param {number} owner - the new owner, or PLAYER_ID_NONE for an unclaim
     * @param {number} permission - the chunk's ChunkPermission; meaningless for an unclaim
     * @returns {void}
     */
    _publishUpdate(session, chunk, owner, permission) {
        const event = new ChunkClaimUpdateEvent(chunk, owner, permission);
        const subscribers = this.game.bus.chunkSubscribers(chunk);
        if (subscribers !== undefined) {
            for (const sessionId of subscribers) {
                this.game.playerDirectory.syncUsernames(sessionId, [owner]);
            }
        }
        this.game.bus.publish(event);
        for (const sessionId of this.game.bus.sessionIdsOf(session.playerId)) {
            if (subscribers === undefined || !subscribers.has(sessionId)) {
                this.game.bus.publishTo(sessionId, event);
            }
        }
    }

    /**
     * The object ids of every solid object in a chunk; non-solid ground cover
     * (resources, water) stays out.
     * @private
     * @param {number} chunk
     * @returns {number[]}
     */
    _solidObjectIdsIn(chunk) {
        const ids = [];
        for (const event of this.game.simEngine.chunkSync(chunk)) {
            let inner = [event];
            if (event instanceof AbstractBatchEvent) {
                inner = event.explode();
            }
            for (const single of inner) {
                if (!(single instanceof ObjectSyncEvent)) {
                    continue;
                }
                const type = this.game.modRegistry.typeById(single.typeId);
                if (type.placement.solid) {
                    ids.push(single.id);
                }
            }
        }
        return ids;
    }
}

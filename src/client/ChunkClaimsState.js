import {WelcomeEvent, PlayerDirectoryEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {ChunkClaimSyncEvent, ChunkClaimUpdateEvent, ClaimResult} from "@/common/ClaimEvents.js";
import {DEFAULT_MAX_CHUNKS, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkNeighbors, syntheticUsername} from "@/common/util.js";
import {AbstractCacheWriter, AbstractCacheView, schemaScalar, schemaMap, schemaSet} from "@/client/ClientCache.js";

export const CHUNK_CLAIMS_SCHEMA = {
    ownPlayerId: schemaScalar(null),
    maxChunks: schemaScalar(DEFAULT_MAX_CHUNKS),
    ownerByChunk: schemaMap(),
    usernameByPlayer: schemaMap(),
    // Players the own player granted build rights to, and players who granted them.
    friendIds: schemaSet(),
    grantedByIds: schemaSet(),
};

/**
 * Writes the chunk-ownership mirror and player directory from the connect-time syncs and the
 * broadcast deltas.
 */
export class ChunkClaimsWriter extends AbstractCacheWriter {

    /**
     * Applies a player/claim event.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof WelcomeEvent) {
            this._state.set("chunkClaims.ownPlayerId", event.playerId);
            this._state.set("chunkClaims.maxChunks", event.maxChunks);
            return;
        }
        if (event instanceof PlayerDirectoryEvent) {
            for (let i = 0; i < event.playerIds.length; i += 1) {
                this._state.mapSet("chunkClaims.usernameByPlayer", event.playerIds[i], event.usernames[i]);
            }
            return;
        }
        if (event instanceof FriendListEvent) {
            this._state.setReplace("chunkClaims.friendIds", event.friendIds);
            this._state.setReplace("chunkClaims.grantedByIds", event.grantedByIds);
            return;
        }
        if (event instanceof ChunkClaimSyncEvent) {
            const synced = new Set(event.chunks);
            for (const [chunk] of this._state.mapEntries("chunkClaims.ownerByChunk")) {
                if (!synced.has(chunk)) {
                    this._state.mapDelete("chunkClaims.ownerByChunk", chunk);
                }
            }
            for (let i = 0; i < event.chunks.length; i += 1) {
                this._state.mapSet("chunkClaims.ownerByChunk", event.chunks[i], event.playerIds[i]);
            }
            return;
        }
        if (event instanceof ChunkClaimUpdateEvent) {
            if (event.playerId === PLAYER_ID_NONE) {
                this._state.mapDelete("chunkClaims.ownerByChunk", event.chunk);
            } else {
                this._state.mapSet("chunkClaims.ownerByChunk", event.chunk, event.playerId);
            }
        }
    }
}

/**
 * Derived reads over the chunkClaims namespace.
 */
export class ChunkClaimsView extends AbstractCacheView {

    /**
     * @returns {number|null} null until the welcome arrives
     */
    get ownPlayerId() {
        return this._state.get("chunkClaims.ownPlayerId");
    }

    /**
     * @returns {number}
     */
    get maxChunks() {
        return this._state.get("chunkClaims.maxChunks");
    }

    /**
     * @param {number} chunk
     * @returns {number} the owning playerId, or PLAYER_ID_NONE when unclaimed
     */
    ownerOf(chunk) {
        const owner = this._state.mapGet("chunkClaims.ownerByChunk", chunk);
        if (owner === undefined) {
            return PLAYER_ID_NONE;
        }
        return owner;
    }

    /**
     * @returns {number} chunks the own player holds
     */
    ownCount() {
        const ownPlayerId = this.ownPlayerId;
        let count = 0;
        for (const [, owner] of this._state.mapEntries("chunkClaims.ownerByChunk")) {
            if (owner === ownPlayerId) {
                count += 1;
            }
        }
        return count;
    }

    /**
     * @returns {number[]} the own player's claimed chunks
     */
    ownChunks() {
        const ownPlayerId = this.ownPlayerId;
        const chunks = [];
        for (const [chunk, owner] of this._state.mapEntries("chunkClaims.ownerByChunk")) {
            if (owner === ownPlayerId) {
                chunks.push(chunk);
            }
        }
        return chunks;
    }

    /**
     * Mirrors the sim's placement gate: own chunks, or chunks whose owner granted build rights.
     * @param {number} chunk
     * @returns {boolean}
     */
    canBuildIn(chunk) {
        const owner = this.ownerOf(chunk);
        if (owner === PLAYER_ID_NONE) {
            return false;
        }
        if (owner === this.ownPlayerId) {
            return true;
        }
        return this.isGrantedBy(owner);
    }

    /**
     * Mirrors the sim's claim checks: what a claim attempt on `chunk` would answer.
     * @param {number} chunk
     * @returns {number} a ClaimResult
     */
    claimCheck(chunk) {
        if (this.ownerOf(chunk) !== PLAYER_ID_NONE) {
            return ClaimResult.CLAIM_RESULT_OWNED;
        }
        const ownCount = this.ownCount();
        if (ownCount >= this.maxChunks) {
            return ClaimResult.CLAIM_RESULT_LIMIT;
        }
        if (ownCount > 0 && !this._touchesOwn(chunk)) {
            return ClaimResult.CLAIM_RESULT_NOT_ADJACENT;
        }
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * Whether an edge neighbor of `chunk` is the own player's.
     * @private
     * @param {number} chunk
     * @returns {boolean}
     */
    _touchesOwn(chunk) {
        for (const neighbor of chunkNeighbors(chunk)) {
            if (this.ownerOf(neighbor) === this.ownPlayerId) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {number} playerId
     * @returns {string}
     */
    usernameOf(playerId) {
        const username = this._state.mapGet("chunkClaims.usernameByPlayer", playerId);
        if (username === undefined) {
            return syntheticUsername(playerId);
        }
        return username;
    }

    /**
     * Whether the own player granted `playerId` build rights.
     * @param {number} playerId
     * @returns {boolean}
     */
    isFriend(playerId) {
        return this._state.setHas("chunkClaims.friendIds", playerId);
    }

    /**
     * Whether `playerId` granted the own player build rights.
     * @param {number} playerId
     * @returns {boolean}
     */
    isGrantedBy(playerId) {
        return this._state.setHas("chunkClaims.grantedByIds", playerId);
    }
}

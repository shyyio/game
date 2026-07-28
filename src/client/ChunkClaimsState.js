import {WelcomeEvent, PlayerDirectoryEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {ChunkClaimSyncEvent, ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {DEFAULT_MAX_CHUNKS, PLAYER_ID_NONE} from "@/common/constants.js";
import {syntheticUsername} from "@/common/util.js";
import {AbstractCacheWriter, AbstractCacheView, schemaScalar, schemaMap, schemaSet} from "@/client/ClientCache.js";

export const CHUNK_CLAIMS_SCHEMA = {
    ownPlayerId: schemaScalar(null),
    maxChunks: schemaScalar(DEFAULT_MAX_CHUNKS),
    ownerByChunk: schemaMap(),
    usernameByPlayer: schemaMap(),
    friendIds: schemaSet(),
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
            this._state.setReplace("chunkClaims.friendIds", event.playerIds);
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
     * @param {number} playerId
     * @returns {boolean}
     */
    isFriend(playerId) {
        return this._state.setHas("chunkClaims.friendIds", playerId);
    }
}

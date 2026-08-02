import {WelcomeEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {OwnClaimsSyncEvent, ChunkClaimUpdateEvent, ClaimResult, ChunkPermission} from "@/common/ClaimEvents.js";
import {ChunkSubscribeEvent} from "@/common/CoreEvents.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {DEFAULT_MAX_CHUNKS, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkNeighbors, chunkCenter} from "@/common/util.js";
import {OverworldRect} from "@/client/OverworldState.js";
import {TILE_SIZE} from "@/client/constants.js";
import {AbstractCacheWriter, AbstractCacheView, schemaScalar, schemaMap, schemaSet} from "@/client/ClientCache.js";

export const CHUNK_CLAIMS_SCHEMA = {
    ownPlayerId: schemaScalar(null),
    maxChunks: schemaScalar(DEFAULT_MAX_CHUNKS),
    // Cached from the welcome at sign-in; never re-fetched, so opening the friends panel never
    // hits the server.
    ownFriendCode: schemaScalar(null),
    // Last-seen ownership mirror; entries persist until a fresher look (subscribe seed or
    // overworld stamp) corrects them.
    ownerByChunk: schemaMap(),
    // Last-seen permission mirror, own and foreign chunks alike; tracks ownerByChunk's lifecycle.
    permissionByChunk: schemaMap(),
    // Every own claim, viewport or not (the centroid, count, and adjacency source).
    ownChunks: schemaSet(),
    // Players the own player granted build rights to, and players who granted them.
    friendIds: schemaSet(),
    grantedByIds: schemaSet(),
};

/**
 * Writes the chunk-ownership mirror from the connect-time own-claims sync, the chunk-topic
 * deltas, the subscribe-time resets, and the overworld snapshots' claim stamps.
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
            this._state.set("chunkClaims.ownFriendCode", event.friendCode);
            return;
        }
        if (event instanceof FriendListEvent) {
            this._state.setReplace("chunkClaims.friendIds", event.friendIds);
            this._state.setReplace("chunkClaims.grantedByIds", event.grantedByIds);
            return;
        }
        if (event instanceof OwnClaimsSyncEvent) {
            this._state.setReplace("chunkClaims.ownChunks", event.chunks);
            const ownPlayerId = this._state.get("chunkClaims.ownPlayerId");
            for (let i = 0; i < event.chunks.length; i += 1) {
                this._state.mapSet("chunkClaims.ownerByChunk", event.chunks[i], ownPlayerId);
                this._state.mapSet("chunkClaims.permissionByChunk", event.chunks[i], event.permissions[i]);
            }
            return;
        }
        if (event instanceof ChunkClaimUpdateEvent) {
            if (event.playerId === PLAYER_ID_NONE) {
                this._state.mapDelete("chunkClaims.ownerByChunk", event.chunk);
                this._state.mapDelete("chunkClaims.permissionByChunk", event.chunk);
                this._state.setDelete("chunkClaims.ownChunks", event.chunk);
                return;
            }
            this._state.mapSet("chunkClaims.ownerByChunk", event.chunk, event.playerId);
            this._state.mapSet("chunkClaims.permissionByChunk", event.chunk, event.permission);
            if (event.playerId === this._state.get("chunkClaims.ownPlayerId")) {
                this._state.setAdd("chunkClaims.ownChunks", event.chunk);
            }
            return;
        }
        if (event instanceof ChunkSubscribeEvent) {
            // A stale foreign entry resets before the seeded update (claimed chunks only) lands.
            this._dropForeign(event.chunk);
            return;
        }
        if (event instanceof OverworldSnapshotEvent) {
            this._stampOverworldClaims(event);
        }
    }

    /**
     * Applies a snapshot's claims across its whole rect: claimed chunks stamp their owner,
     * unclaimed ones shed any stale foreign entry.
     * @private
     * @param {OverworldSnapshotEvent} event
     * @returns {void}
     */
    _stampOverworldClaims(event) {
        const ownerByChunk = new Map();
        const permissionByChunk = new Map();
        for (let i = 0; i < event.claimedChunks.length; i += 1) {
            ownerByChunk.set(event.claimedChunks[i], event.claimOwners[i]);
            permissionByChunk.set(event.claimedChunks[i], event.claimPermissions[i]);
        }
        const rect = new OverworldRect(event.chunkX, event.chunkY, event.chunkWidth, event.chunkHeight);
        for (const chunk of rect.ordinals()) {
            const owner = ownerByChunk.get(chunk);
            if (owner === undefined) {
                this._dropForeign(chunk);
            } else {
                this._state.mapSet("chunkClaims.ownerByChunk", chunk, owner);
                this._state.mapSet("chunkClaims.permissionByChunk", chunk, permissionByChunk.get(chunk));
            }
        }
    }

    /**
     * Removes a chunk's ownership entry unless it is the own player's (own claims track the
     * targeted updates alone).
     * @private
     * @param {number} chunk
     * @returns {void}
     */
    _dropForeign(chunk) {
        const owner = this._state.mapGet("chunkClaims.ownerByChunk", chunk);
        if (owner !== undefined && owner !== this._state.get("chunkClaims.ownPlayerId")) {
            this._state.mapDelete("chunkClaims.ownerByChunk", chunk);
            this._state.mapDelete("chunkClaims.permissionByChunk", chunk);
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
     * @returns {string|null} null until the welcome arrives
     */
    get ownFriendCode() {
        return this._state.get("chunkClaims.ownFriendCode");
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
        return this._state.setSize("chunkClaims.ownChunks");
    }

    /**
     * @returns {number[]} the own player's claimed chunks
     */
    ownChunks() {
        return [...this._state.setValues("chunkClaims.ownChunks")];
    }

    /**
     * @param {number} chunk
     * @returns {number} the chunk's ChunkPermission, defaulting to friends-only when unclaimed
     */
    permissionOf(chunk) {
        const permission = this._state.mapGet("chunkClaims.permissionByChunk", chunk);
        if (permission === undefined) {
            return ChunkPermission.PERMISSION_FRIENDS;
        }
        return permission;
    }

    /**
     * Mirrors the sim's placement gate: the owner always can, permission gates everyone else.
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
        if (this.permissionOf(chunk) === ChunkPermission.PERMISSION_ONLY_ME) {
            return false;
        }
        return this.isFriendsWithMe(owner);
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
            if (this._state.setHas("chunkClaims.ownChunks", neighbor)) {
                return true;
            }
        }
        return false;
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
    isFriendsWithMe(playerId) {
        return this._state.setHas("chunkClaims.grantedByIds", playerId);
    }

    /**
     * @returns {number[]} players the own player granted build rights to
     */
    friendIds() {
        return [...this._state.setValues("chunkClaims.friendIds")];
    }

    /**
     * The distinct foreign, non-friend owners of `chunks`, nearest-chunk-first by distance to
     * (centerX, centerY) in world px; a player can own several of the chunks, only their
     * nearest counts.
     * @param {Iterable<number>} chunks
     * @param {number} centerX
     * @param {number} centerY
     * @returns {number[]}
     */
    nearbyForeignOwners(chunks, centerX, centerY) {
        const nearestByOwner = new Map();
        for (const chunk of chunks) {
            const owner = this.ownerOf(chunk);
            if (owner === PLAYER_ID_NONE || owner === this.ownPlayerId || this.isFriend(owner)) {
                continue;
            }
            const point = chunkCenter(chunk);
            const dx = point.x * TILE_SIZE - centerX;
            const dy = point.y * TILE_SIZE - centerY;
            const distance = dx * dx + dy * dy;
            const nearest = nearestByOwner.get(owner);
            if (nearest === undefined || distance < nearest) {
                nearestByOwner.set(owner, distance);
            }
        }
        return [...nearestByOwner.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    }
}

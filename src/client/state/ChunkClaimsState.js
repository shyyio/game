import {WelcomeEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {OwnClaimsSyncEvent, ChunkClaimUpdateEvent, ClaimResult, ChunkPermission} from "@/common/ClaimEvents.js";
import {ChunkSubscribeEvent} from "@/common/CoreEvents.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {DEFAULT_MAX_CHUNKS, PLAYER_REF_NONE} from "@/common/constants.js";
import {chunkNeighbors, chunkCenter} from "@/common/util.js";
import {OverworldRect} from "@/client/state/OverworldState.js";
import {TILE_SIZE} from "@/client/constants.js";
import {AbstractCacheWriter, AbstractCacheView, schemaScalar, schemaMap, schemaSet} from "@/client/state/ClientCache.js";

export const CHUNK_CLAIMS_SCHEMA = {
    ownPlayerRef: schemaScalar(null),
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
            this._state.set("chunkClaims.ownPlayerRef", event.playerRef);
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
            const ownPlayerRef = this._state.get("chunkClaims.ownPlayerRef");
            for (let i = 0; i < event.chunks.length; i += 1) {
                this._state.mapSet("chunkClaims.ownerByChunk", event.chunks[i], ownPlayerRef);
                this._state.mapSet("chunkClaims.permissionByChunk", event.chunks[i], event.permissions[i]);
            }
            return;
        }
        if (event instanceof ChunkClaimUpdateEvent) {
            if (event.playerRef === PLAYER_REF_NONE) {
                this._state.mapDelete("chunkClaims.ownerByChunk", event.chunkKey);
                this._state.mapDelete("chunkClaims.permissionByChunk", event.chunkKey);
                this._state.setDelete("chunkClaims.ownChunks", event.chunkKey);
                return;
            }
            this._state.mapSet("chunkClaims.ownerByChunk", event.chunkKey, event.playerRef);
            this._state.mapSet("chunkClaims.permissionByChunk", event.chunkKey, event.permission);
            if (event.playerRef === this._state.get("chunkClaims.ownPlayerRef")) {
                this._state.setAdd("chunkClaims.ownChunks", event.chunkKey);
            }
            return;
        }
        if (event instanceof ChunkSubscribeEvent) {
            // A stale foreign entry resets before the seeded update (claimed chunks only) lands.
            this._dropForeign(event.chunkKey);
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
     * @param {number} chunkKey
     * @returns {void}
     */
    _dropForeign(chunkKey) {
        const owner = this._state.mapGet("chunkClaims.ownerByChunk", chunkKey);
        if (owner !== undefined && owner !== this._state.get("chunkClaims.ownPlayerRef")) {
            this._state.mapDelete("chunkClaims.ownerByChunk", chunkKey);
            this._state.mapDelete("chunkClaims.permissionByChunk", chunkKey);
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
    get ownPlayerRef() {
        return this._state.get("chunkClaims.ownPlayerRef");
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
     * @param {number} chunkKey
     * @returns {number} the owning playerRef, or PLAYER_REF_NONE when unclaimed
     */
    getOwnerByChunkKey(chunkKey) {
        const owner = this._state.mapGet("chunkClaims.ownerByChunk", chunkKey);
        if (owner === undefined) {
            return PLAYER_REF_NONE;
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
     * @returns {boolean}
     */
    hasOwnClaims() {
        return this.ownCount() > 0;
    }

    /**
     * @returns {boolean} whether the own player holds every chunk they may
     */
    atChunkLimit() {
        return this.ownCount() >= this.maxChunks;
    }

    /**
     * @returns {number[]} the own player's claimed chunks
     */
    ownChunks() {
        return Array.from(this._state.setValues("chunkClaims.ownChunks"));
    }

    /**
     * @param {number} chunkKey
     * @returns {number} the chunk's ChunkPermission, defaulting to owner-only when unclaimed
     */
    getPermissionByChunkKey(chunkKey) {
        const permission = this._state.mapGet("chunkClaims.permissionByChunk", chunkKey);
        if (permission === undefined) {
            return ChunkPermission.PERMISSION_ONLY_ME;
        }
        return permission;
    }

    /**
     * Mirrors the sim's placement gate: the owner always can, permission gates everyone else.
     * @param {number} chunkKey
     * @returns {boolean}
     */
    canBuildIn(chunkKey) {
        const owner = this.getOwnerByChunkKey(chunkKey);
        if (owner === PLAYER_REF_NONE) {
            return false;
        }
        if (owner === this.ownPlayerRef) {
            return true;
        }
        if (this.getPermissionByChunkKey(chunkKey) === ChunkPermission.PERMISSION_ONLY_ME) {
            return false;
        }
        return this.isFriendsWithMe(owner);
    }

    /**
     * Mirrors the sim's claim checks: what a claim attempt on `chunk` would answer.
     * @param {number} chunkKey
     * @returns {number} a ClaimResult
     */
    claimCheck(chunkKey) {
        if (this.getOwnerByChunkKey(chunkKey) !== PLAYER_REF_NONE) {
            return ClaimResult.CLAIM_RESULT_OWNED;
        }
        if (this.atChunkLimit()) {
            return ClaimResult.CLAIM_RESULT_LIMIT;
        }
        if (this.ownCount() > 0 && !this._touchesOwn(chunkKey)) {
            return ClaimResult.CLAIM_RESULT_NOT_ADJACENT;
        }
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * Whether an edge neighbor of `chunk` is the own player's.
     * @private
     * @param {number} chunkKey
     * @returns {boolean}
     */
    _touchesOwn(chunkKey) {
        for (const neighbor of chunkNeighbors(chunkKey)) {
            if (this._state.setHas("chunkClaims.ownChunks", neighbor)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Whether the own player granted `playerRef` build rights.
     * @param {number} playerRef
     * @returns {boolean}
     */
    isFriend(playerRef) {
        return this._state.setHas("chunkClaims.friendIds", playerRef);
    }

    /**
     * Whether `playerRef` granted the own player build rights.
     * @param {number} playerRef
     * @returns {boolean}
     */
    isFriendsWithMe(playerRef) {
        return this._state.setHas("chunkClaims.grantedByIds", playerRef);
    }

    /**
     * @returns {number[]} players the own player granted build rights to
     */
    friendIds() {
        return Array.from(this._state.setValues("chunkClaims.friendIds"));
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
            const owner = this.getOwnerByChunkKey(chunk);
            if (owner === PLAYER_REF_NONE || owner === this.ownPlayerRef || this.isFriend(owner)) {
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
        return Array.from(nearestByOwner.entries()).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    }
}

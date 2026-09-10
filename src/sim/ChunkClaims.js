import {PLAYER_REF_NONE} from "@/common/constants.js";
import {ClaimResult, ChunkPermission} from "@/common/ClaimEvents.js";
import {chunkNeighbors, chunkPosition} from "@/common/util.js";

export const CHUNK_CLAIM_TABLE = "ChunkClaim";

/**
 * @typedef {Object} ChunkClaimRows
 * @property {number[]} chunks
 * @property {number[]} playerRefs
 * @property {number[]} permissions
 */

/**
 * Chunk ownership: which player owns each claimed chunk. A player's claimed chunks stay contiguous:
 * every claim after the first must touch an own chunk edge-on, and an unclaim that would split the
 * remainder is rejected.
 */
export class ChunkClaims {

    constructor() {
        /**
         * @type {Map<number, number>} chunk ordinal -> owning playerRef
         */
        this._ownerByChunk = new Map();
        /**
         * @type {Map<number, number>} chunk ordinal -> ChunkPermission, own entries only
         */
        this._permissionByChunk = new Map();
    }

    /**
     * @param {number} chunkKey
     * @returns {number} the owning playerRef, or PLAYER_REF_NONE when unclaimed
     */
    getOwnerByChunkKey(chunkKey) {
        const owner = this._ownerByChunk.get(chunkKey);
        if (owner === undefined) {
            return PLAYER_REF_NONE;
        }
        return owner;
    }

    /**
     * @param {number} chunkKey
     * @returns {number} the chunk's ChunkPermission, defaulting to owner-only when unclaimed
     */
    getPermissionByChunkKey(chunkKey) {
        const permission = this._permissionByChunk.get(chunkKey);
        if (permission === undefined) {
            return ChunkPermission.PERMISSION_ONLY_ME;
        }
        return permission;
    }

    /**
     * @param {number} playerRef
     * @returns {number}
     */
    getCountByPlayerRef(playerRef) {
        return this.getChunkKeysByPlayerRef(playerRef).size;
    }

    /**
     * @returns {number} the total number of claimed chunks, across every player
     */
    getClaimedCount() {
        return this._ownerByChunk.size;
    }

    /**
     * Derived by scanning the ownership map: claims are rare user-rate operations on a small map.
     * @param {number} playerRef
     * @returns {Set<number>}
     */
    getChunkKeysByPlayerRef(playerRef) {
        const chunks = new Set();
        for (const [chunkKey, owner] of this._ownerByChunk) {
            if (owner === playerRef) {
                chunks.add(chunkKey);
            }
        }
        return chunks;
    }

    /**
     * Mirrored client-side by ChunkClaimsView.claimCheck; keep the rule order in sync.
     * @param {number} playerRef
     * @param {number} chunkKey
     * @param {number} maxChunks
     * @returns {number} a ClaimResult
     */
    claim(playerRef, chunkKey, maxChunks) {
        if (playerRef === PLAYER_REF_NONE) {
            throw new RangeError("The null player cannot claim chunks");
        }
        if (this._ownerByChunk.has(chunkKey)) {
            return ClaimResult.CLAIM_RESULT_OWNED;
        }
        const owned = this.getChunkKeysByPlayerRef(playerRef);
        if (owned.size >= maxChunks) {
            return ClaimResult.CLAIM_RESULT_LIMIT;
        }
        if (owned.size > 0 && !this._isTouchingOwn(chunkKey, owned)) {
            return ClaimResult.CLAIM_RESULT_NOT_ADJACENT;
        }
        this._ownerByChunk.set(chunkKey, playerRef);
        this._permissionByChunk.set(chunkKey, ChunkPermission.PERMISSION_ONLY_ME);
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * @param {number} playerRef
     * @param {number} chunkKey
     * @returns {number} a ClaimResult
     */
    unclaim(playerRef, chunkKey) {
        const check = this.unclaimCheck(playerRef, chunkKey);
        if (check !== ClaimResult.CLAIM_RESULT_OK) {
            return check;
        }
        this._ownerByChunk.delete(chunkKey);
        this._permissionByChunk.delete(chunkKey);
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * @param {number} playerRef
     * @param {number} chunkKey
     * @param {number} permission - a ChunkPermission
     * @returns {number} a ClaimResult
     */
    setPermission(playerRef, chunkKey, permission) {
        if (this._ownerByChunk.get(chunkKey) !== playerRef) {
            return ClaimResult.CLAIM_RESULT_NOT_OWNER;
        }
        this._permissionByChunk.set(chunkKey, permission);
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * Whether an unclaim would succeed, without applying it.
     * @param {number} playerRef
     * @param {number} chunkKey
     * @returns {number} a ClaimResult
     */
    unclaimCheck(playerRef, chunkKey) {
        if (this._ownerByChunk.get(chunkKey) !== playerRef) {
            return ClaimResult.CLAIM_RESULT_NOT_OWNER;
        }
        if (!this._isConnectedWithout(this.getChunkKeysByPlayerRef(playerRef), chunkKey)) {
            return ClaimResult.CLAIM_RESULT_WOULD_SPLIT;
        }
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * The (chunk, owner) pairs inside a chunk-coordinate rect as parallel arrays, by scanning the
     * ownership map: claims are few, rects can span the region.
     * @param {number} chunkX
     * @param {number} chunkY
     * @param {number} chunkWidth
     * @param {number} chunkHeight
     * @returns {ChunkClaimRows}
     */
    getClaimsInRect(chunkX, chunkY, chunkWidth, chunkHeight) {
        const chunks = [];
        const playerRefs = [];
        const permissions = [];
        for (const [chunkKey, playerRef] of this._ownerByChunk) {
            const position = chunkPosition(chunkKey);
            if (position.x < chunkX || position.x >= chunkX + chunkWidth
                || position.y < chunkY || position.y >= chunkY + chunkHeight) {
                continue;
            }
            chunks.push(chunkKey);
            playerRefs.push(playerRef);
            permissions.push(this.getPermissionByChunkKey(chunkKey));
        }
        return {chunks, playerRefs, permissions};
    }

    /**
     * @returns {object} the ChunkClaim table
     */
    serializeTables() {
        const rows = [];
        for (const [chunkKey, playerRef] of this._ownerByChunk) {
            rows.push({chunkKey, playerRef: playerRef, permission: this.getPermissionByChunkKey(chunkKey)});
        }
        return {
            name: CHUNK_CLAIM_TABLE,
            fields: [
                {name: "chunkKey", kind: "integer"},
                {name: "playerRef", kind: "integer"},
                {name: "permission", kind: "integer"},
            ],
            rows,
        };
    }

    /**
     * @param {object|undefined} table - the ChunkClaim table; undefined clears
     * @returns {void}
     */
    deserializeTables(table) {
        this._ownerByChunk.clear();
        this._permissionByChunk.clear();
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            this._ownerByChunk.set(row.chunkKey, row.playerRef);
            this._permissionByChunk.set(row.chunkKey, row.permission);
        }
    }

    /**
     * @private
     * @param {number} chunkKey
     * @param {Set<number>} owned
     * @returns {boolean}
     */
    _isTouchingOwn(chunkKey, owned) {
        for (const neighbor of chunkNeighbors(chunkKey)) {
            if (owned.has(neighbor)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Whether the owned set stays edge-connected once `removed` is taken out.
     * @private
     * @param {Set<number>} owned
     * @param {number} removed
     * @returns {boolean}
     */
    _isConnectedWithout(owned, removed) {
        const remaining = new Set(owned);
        remaining.delete(removed);
        if (remaining.size <= 1) {
            return true;
        }
        const seed = remaining.values().next().value;
        const visited = new Set([seed]);
        const frontier = [seed];
        while (frontier.length > 0) {
            const chunkKey = frontier.pop();
            for (const neighbor of chunkNeighbors(chunkKey)) {
                if (remaining.has(neighbor) && !visited.has(neighbor)) {
                    visited.add(neighbor);
                    frontier.push(neighbor);
                }
            }
        }
        return visited.size === remaining.size;
    }
}

import {PLAYER_ID_NONE} from "@/common/constants.js";
import {ClaimResult, ChunkPermission} from "@/common/ClaimEvents.js";
import {chunkNeighbors, chunkPosition} from "@/common/util.js";

export const CHUNK_CLAIM_RECORD = "ChunkClaim";

/**
 * Chunk ownership: which player owns each claimed chunk. A player's claimed chunks stay contiguous:
 * every claim after the first must touch an own chunk edge-on, and an unclaim that would split the
 * remainder is rejected.
 */
export class ChunkClaims {

    constructor() {
        /**
         * @type {Map<number, number>} chunk ordinal -> owning playerId
         */
        this._ownerByChunk = new Map();
        /**
         * @type {Map<number, number>} chunk ordinal -> ChunkPermission, own entries only
         */
        this._permissionByChunk = new Map();
    }

    /**
     * @param {number} chunk
     * @returns {number} the owning playerId, or PLAYER_ID_NONE when unclaimed
     */
    ownerOf(chunk) {
        const owner = this._ownerByChunk.get(chunk);
        if (owner === undefined) {
            return PLAYER_ID_NONE;
        }
        return owner;
    }

    /**
     * @param {number} chunk
     * @returns {number} the chunk's ChunkPermission, defaulting to owner-only when unclaimed
     */
    permissionOf(chunk) {
        const permission = this._permissionByChunk.get(chunk);
        if (permission === undefined) {
            return ChunkPermission.PERMISSION_ONLY_ME;
        }
        return permission;
    }

    /**
     * @param {number} playerId
     * @returns {number}
     */
    countOf(playerId) {
        return this.chunksOf(playerId).size;
    }

    /**
     * @returns {number} the total number of claimed chunks, across every player
     */
    claimedCount() {
        return this._ownerByChunk.size;
    }

    /**
     * Derived by scanning the ownership map: claims are rare user-rate operations on a small map.
     * @param {number} playerId
     * @returns {Set<number>}
     */
    chunksOf(playerId) {
        const chunks = new Set();
        for (const [chunk, owner] of this._ownerByChunk) {
            if (owner === playerId) {
                chunks.add(chunk);
            }
        }
        return chunks;
    }

    /**
     * Mirrored client-side by ChunkClaimsView.claimCheck; keep the rule order in sync.
     * @param {number} playerId
     * @param {number} chunk
     * @param {number} maxChunks
     * @returns {number} a ClaimResult
     */
    claim(playerId, chunk, maxChunks) {
        if (playerId === PLAYER_ID_NONE) {
            throw new RangeError("The null player cannot claim chunks");
        }
        if (this._ownerByChunk.has(chunk)) {
            return ClaimResult.CLAIM_RESULT_OWNED;
        }
        const owned = this.chunksOf(playerId);
        if (owned.size >= maxChunks) {
            return ClaimResult.CLAIM_RESULT_LIMIT;
        }
        if (owned.size > 0 && !this._touchesOwn(chunk, owned)) {
            return ClaimResult.CLAIM_RESULT_NOT_ADJACENT;
        }
        this._ownerByChunk.set(chunk, playerId);
        this._permissionByChunk.set(chunk, ChunkPermission.PERMISSION_ONLY_ME);
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * @param {number} playerId
     * @param {number} chunk
     * @returns {number} a ClaimResult
     */
    unclaim(playerId, chunk) {
        const check = this.unclaimCheck(playerId, chunk);
        if (check !== ClaimResult.CLAIM_RESULT_OK) {
            return check;
        }
        this._ownerByChunk.delete(chunk);
        this._permissionByChunk.delete(chunk);
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * @param {number} playerId
     * @param {number} chunk
     * @param {number} permission - a ChunkPermission
     * @returns {number} a ClaimResult
     */
    setPermission(playerId, chunk, permission) {
        if (this._ownerByChunk.get(chunk) !== playerId) {
            return ClaimResult.CLAIM_RESULT_NOT_OWNER;
        }
        this._permissionByChunk.set(chunk, permission);
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * Whether an unclaim would succeed, without applying it.
     * @param {number} playerId
     * @param {number} chunk
     * @returns {number} a ClaimResult
     */
    unclaimCheck(playerId, chunk) {
        if (this._ownerByChunk.get(chunk) !== playerId) {
            return ClaimResult.CLAIM_RESULT_NOT_OWNER;
        }
        if (!this._connectedWithout(this.chunksOf(playerId), chunk)) {
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
     * @returns {{chunks: number[], playerIds: number[], permissions: number[]}}
     */
    claimsIn(chunkX, chunkY, chunkWidth, chunkHeight) {
        const chunks = [];
        const playerIds = [];
        const permissions = [];
        for (const [chunk, playerId] of this._ownerByChunk) {
            const position = chunkPosition(chunk);
            if (position.x < chunkX || position.x >= chunkX + chunkWidth
                || position.y < chunkY || position.y >= chunkY + chunkHeight) {
                continue;
            }
            chunks.push(chunk);
            playerIds.push(playerId);
            permissions.push(this.permissionOf(chunk));
        }
        return {chunks, playerIds, permissions};
    }

    /**
     * @returns {object} the ChunkClaim record table
     */
    serializeRecords() {
        const rows = [];
        for (const [chunk, playerId] of this._ownerByChunk) {
            rows.push({chunk, player_id: playerId, permission: this.permissionOf(chunk)});
        }
        return {
            name: CHUNK_CLAIM_RECORD,
            fields: [
                {name: "chunk", kind: "integer"},
                {name: "player_id", kind: "integer"},
                {name: "permission", kind: "integer"},
            ],
            rows,
        };
    }

    /**
     * @param {object|undefined} table - the ChunkClaim record table; undefined clears
     * @returns {void}
     */
    deserializeRecords(table) {
        this._ownerByChunk.clear();
        this._permissionByChunk.clear();
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            this._ownerByChunk.set(row.chunk, row.player_id);
            this._permissionByChunk.set(row.chunk, row.permission);
        }
    }

    /**
     * @private
     * @param {number} chunk
     * @param {Set<number>} owned
     * @returns {boolean}
     */
    _touchesOwn(chunk, owned) {
        for (const neighbor of chunkNeighbors(chunk)) {
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
    _connectedWithout(owned, removed) {
        const remaining = new Set(owned);
        remaining.delete(removed);
        if (remaining.size <= 1) {
            return true;
        }
        const seed = remaining.values().next().value;
        const visited = new Set([seed]);
        const frontier = [seed];
        while (frontier.length > 0) {
            const chunk = frontier.pop();
            for (const neighbor of chunkNeighbors(chunk)) {
                if (remaining.has(neighbor) && !visited.has(neighbor)) {
                    visited.add(neighbor);
                    frontier.push(neighbor);
                }
            }
        }
        return visited.size === remaining.size;
    }
}

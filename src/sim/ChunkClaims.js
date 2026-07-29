import {PLAYER_ID_NONE} from "@/common/constants.js";
import {ClaimResult} from "@/common/ClaimEvents.js";
import {chunkNeighbors} from "@/common/util.js";

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
     * @param {number} playerId
     * @returns {number}
     */
    countOf(playerId) {
        return this.chunksOf(playerId).size;
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
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * @param {number} playerId
     * @param {number} chunk
     * @returns {number} a ClaimResult
     */
    unclaim(playerId, chunk) {
        if (this._ownerByChunk.get(chunk) !== playerId) {
            return ClaimResult.CLAIM_RESULT_NOT_OWNER;
        }
        if (!this._connectedWithout(this.chunksOf(playerId), chunk)) {
            return ClaimResult.CLAIM_RESULT_WOULD_SPLIT;
        }
        this._ownerByChunk.delete(chunk);
        return ClaimResult.CLAIM_RESULT_OK;
    }

    /**
     * The full ownership map as parallel arrays, for the connect-time sync event.
     * @returns {{chunks: number[], playerIds: number[]}}
     */
    snapshot() {
        const chunks = [];
        const playerIds = [];
        for (const [chunk, playerId] of this._ownerByChunk) {
            chunks.push(chunk);
            playerIds.push(playerId);
        }
        return {chunks, playerIds};
    }

    /**
     * @returns {object} the ChunkClaim record table
     */
    serializeRecords() {
        const rows = [];
        for (const [chunk, playerId] of this._ownerByChunk) {
            rows.push({chunk, player_id: playerId});
        }
        return {
            name: CHUNK_CLAIM_RECORD,
            fields: [
                {name: "chunk", kind: "integer"},
                {name: "player_id", kind: "integer"},
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
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            this._ownerByChunk.set(row.chunk, row.player_id);
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

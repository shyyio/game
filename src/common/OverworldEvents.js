import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * The baked tile runs of every non-empty chunk in a requested rect; rect chunks absent from
 * `chunks` are empty. Claimed chunks ride along as (claimedChunks, claimOwners) pairs, owner
 * names pushed separately beforehand. Sent per-session via publishTo, never topic-published.
 */
export class OverworldSnapshotEvent extends AbstractEvent {

    static wireFields = {
        chunkX: "sint32",
        chunkY: "sint32",
        chunkWidth: "int32",
        chunkHeight: "int32",
        chunks: "int32[]",
        runCounts: "int32[]",
        runStarts: "int32[]",
        runLengths: "int32[]",
        runTypeIds: "int32[]",
        claimedChunks: "int32[]",
        claimOwners: "int64[]",
        claimPermissions: "int32[]",
    };

    /**
     * @param {number} chunkX
     * @param {number} chunkY
     * @param {number} chunkWidth
     * @param {number} chunkHeight
     */
    constructor(chunkX, chunkY, chunkWidth, chunkHeight) {
        super();
        this.chunkX = chunkX;
        this.chunkY = chunkY;
        this.chunkWidth = chunkWidth;
        this.chunkHeight = chunkHeight;
        // Non-empty chunk ordinals, ascending; run columns flattened per chunk.
        this.chunks = [];
        this.runCounts = [];
        this.runStarts = [];
        this.runLengths = [];
        this.runTypeIds = [];
        // Claimed chunk ordinals in the rect and their owners/permissions, parallel.
        this.claimedChunks = [];
        this.claimOwners = [];
        this.claimPermissions = [];
    }

    /**
     * Appends one chunk's runs (parallel arrays: in-chunk tile offset, length, objectTypeId).
     * @param {number} chunkKey
     * @param {number[]} starts
     * @param {number[]} lengths
     * @param {number[]} objectTypeIds
     * @returns {void}
     */
    addChunk(chunkKey, starts, lengths, objectTypeIds) {
        this.chunks.push(chunkKey);
        this.runCounts.push(starts.length);
        this.runStarts.push(...starts);
        this.runLengths.push(...lengths);
        this.runTypeIds.push(...objectTypeIds);
    }
}

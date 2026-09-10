import {PLAYER_REF_NONE} from "@/common/constants.js";

/**
 * Who owns a chunk and who may build in it. The base is the open world of a test without a Game:
 * nobody owns anything and everyone may build; ChunkClaimIndex answers from the claims.
 */
export class ChunkOwnerIndex {

    /**
     * @param {number} playerRef
     * @param {number} chunkKey
     * @returns {boolean}
     */
    canBuildIn(playerRef, chunkKey) {
        return true;
    }

    /**
     * @param {number} chunkKey
     * @returns {number} the owning playerRef, PLAYER_REF_NONE when unclaimed
     */
    getOwnerByChunkKey(chunkKey) {
        return PLAYER_REF_NONE;
    }
}

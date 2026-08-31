import {TILE_SIZE} from "@/client/constants.js";
import {chunkCenter} from "@/common/util.js";

/**
 * Where the viewport sits: the scripted moves that put the player's own claims on screen.
 */
export class Camera {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
    }

    /**
     * The world-pixel centroid of the player's claimed chunks, or null with none.
     * @returns {{x: number, y: number}|null}
     */
    ownClaimsCenter() {
        const chunks = this._client.cache.view("chunkClaims").ownChunks();
        if (chunks.length === 0) {
            return null;
        }
        let sumX = 0;
        let sumY = 0;
        for (const chunk of chunks) {
            const center = chunkCenter(chunk);
            sumX += center.x * TILE_SIZE;
            sumY += center.y * TILE_SIZE;
        }
        return {x: sumX / chunks.length, y: sumY / chunks.length};
    }

    /**
     * Glides the viewport to the claims centroid at the current zoom; a no-op with no claims.
     * @returns {void}
     */
    glideHome() {
        const center = this.ownClaimsCenter();
        if (center === null) {
            return;
        }
        this._client.viewport.glideTo({x: center.x, y: center.y});
    }

    /**
     * Snaps the viewport to the claims centroid with no glide; a no-op with no claims.
     * @returns {void}
     */
    startAtHome() {
        const center = this.ownClaimsCenter();
        if (center === null) {
            return;
        }
        this._client.viewport.moveCenter(center.x, center.y);
        // moveCenter emits no "moved"; refresh the data feed directly.
        this._client.viewportMoved();
    }

}

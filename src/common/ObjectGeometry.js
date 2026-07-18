import {rotate, chunkId} from "@/common/util.js";

/**
 * The geometry for a named object size: a base (unrotated) extent vector plus the
 * direction-aware tile math derived from it. An ObjectType exposes its one via `size`.
 */
export class ObjectGeometry {

    /**
     * @param {Vec} extent - the base (unrotated) max cell offset (0,0 for a single tile)
     */
    constructor(extent) {
        this.extent = extent;
    }

    /**
     * The extent corner rotated for a placement direction.
     * @param {Direction} direction
     * @returns {Vec}
     */
    corner(direction) {
        return rotate(this.extent, direction);
    }

    /**
     * The tile offsets this geometry covers facing `direction` (relative; add the base tile to get
     * world tiles). A single tile for a 1x1 (0-extent) size.
     * @param {Direction} direction
     * @returns {{x: number, y: number}[]}
     */
    tiles(direction) {
        const corner = this.corner(direction);
        const stepX = Math.sign(corner.x);
        const stepY = Math.sign(corner.y);
        const tiles = [];
        for (let i = 0; i <= Math.abs(corner.x); i += 1) {
            for (let j = 0; j <= Math.abs(corner.y); j += 1) {
                tiles.push({x: i * stepX, y: j * stepY});
            }
        }
        return tiles;
    }

    /**
     * Whether this geometry at (tileX, tileY) facing `direction` crosses a chunk boundary; placement
     * rejects it, so every object lives in exactly one chunk (chunk-keyed sync/position assume that).
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {boolean}
     */
    spansChunks(tileX, tileY, direction) {
        const base = chunkId(tileX, tileY);
        return this.tiles(direction).some(tile => chunkId(tileX + tile.x, tileY + tile.y) !== base);
    }
}

// Named object geometries; names match the inspect/<name> (and other per-size) textures.
export const ObjectGeometries = {
    "1x1": new ObjectGeometry({x: 0, y: 0}),
    "1x2": new ObjectGeometry({x: 1, y: 0}),
    "2x2": new ObjectGeometry({x: 1, y: 1}),
};

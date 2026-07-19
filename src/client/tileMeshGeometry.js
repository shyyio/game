import {TILE_SIZE} from "@/client/constants.js";

// Vertices and indices a tile quad contributes.
export const VERTICES_PER_TILE = 4;
export const INDICES_PER_TILE = 6;

// The quad's corners, counter-clockwise from the top-left, as unit offsets within a tile.
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * The corner of the source frame that a quad corner samples, for a sprite turned `quarterTurns`
 * clockwise: turning the image forward shifts each position corner back around the frame.
 * @param {number} corner - position corner, counter-clockwise from the top-left
 * @param {number} quarterTurns - clockwise 90-degree turns
 * @returns {number} the frame corner to sample
 */
export function rotatedCorner(corner, quarterTurns) {
    const turned = (corner - quarterTurns) % CORNERS.length;
    return turned < 0 ? turned + CORNERS.length : turned;
}

/**
 * Fills the vertex and index columns for one tile: an axis-aligned quad at its tile, sampling the
 * frame corners its facing rotates onto. Rotation rides in the corner assignment rather than the
 * positions, so a turned tile costs no trigonometry.
 * @param {TileMeshColumns} columns
 * @param {number} tile - the tile's index in the mesh
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} quarterTurns - clockwise 90-degree turns
 * @param {number} sequence - the frame table slot this tile animates through
 * @returns {void}
 */
export function writeTile(columns, tile, tileX, tileY, quarterTurns, sequence) {
    const vertex = tile * VERTICES_PER_TILE;
    const originX = tileX * TILE_SIZE;
    const originY = tileY * TILE_SIZE;

    for (let corner = 0; corner < CORNERS.length; corner += 1) {
        const [offsetX, offsetY] = CORNERS[corner];
        const [uvX, uvY] = CORNERS[rotatedCorner(corner, quarterTurns)];
        const at = vertex + corner;
        columns.positions[at * 2] = originX + offsetX * TILE_SIZE;
        columns.positions[at * 2 + 1] = originY + offsetY * TILE_SIZE;
        columns.uvs[at * 2] = uvX;
        columns.uvs[at * 2 + 1] = uvY;
        columns.sequences[at] = sequence;
    }

    // Two triangles over the quad: 0-1-2 and 0-2-3.
    const index = tile * INDICES_PER_TILE;
    columns.indices[index] = vertex;
    columns.indices[index + 1] = vertex + 1;
    columns.indices[index + 2] = vertex + 2;
    columns.indices[index + 3] = vertex;
    columns.indices[index + 4] = vertex + 2;
    columns.indices[index + 5] = vertex + 3;
}

/**
 * The vertex and index columns backing one mesh, sized for a fixed tile count.
 */
export class TileMeshColumns {

    /**
     * @param {number} tiles
     */
    constructor(tiles) {
        this.tiles = tiles;
        this.positions = new Float32Array(tiles * VERTICES_PER_TILE * 2);
        this.uvs = new Float32Array(tiles * VERTICES_PER_TILE * 2);
        this.sequences = new Float32Array(tiles * VERTICES_PER_TILE);
        this.indices = new Uint32Array(tiles * INDICES_PER_TILE);
    }
}

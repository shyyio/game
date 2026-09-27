import {TILE_SIZE, chunksOver, snapToChunk} from "@/client/constants.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";

/**
 * The copyable objects with a cell under the world rectangle between two points, in the order they
 * were placed (object refs count up with placement).
 * @param {ObjectsView} objects
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @returns {CacheEntry[]}
 */
export function getCopyableEntriesInRect(objects, fromX, fromY, toX, toY) {
    const minTileX = Math.floor(Math.min(fromX, toX) / TILE_SIZE);
    const minTileY = Math.floor(Math.min(fromY, toY) / TILE_SIZE);
    const maxTileX = Math.floor(Math.max(fromX, toX) / TILE_SIZE);
    const maxTileY = Math.floor(Math.max(fromY, toY) / TILE_SIZE);
    const selected = [];
    for (const chunkKey of chunksOver(snapToChunk(minTileX), snapToChunk(minTileY), maxTileX, maxTileY)) {
        for (const entry of objects.getByChunk(chunkKey)) {
            if (!entry.data.type.placement.isCopyable) {
                continue;
            }
            if (entry.cells.some(cell => cell.x >= minTileX && cell.x <= maxTileX && cell.y >= minTileY && cell.y <= maxTileY)) {
                selected.push(entry);
            }
        }
    }
    selected.sort((a, b) => a.id - b.id);
    return selected;
}

/**
 * The selection as a blueprint, anchored on its top-left object cell.
 * @param {CacheEntry[]} selected in placement order
 * @returns {Blueprint}
 */
export function buildBlueprint(selected) {
    let anchorTileX = Infinity;
    let anchorTileY = Infinity;
    for (const entry of selected) {
        const bounds = entry.tileBounds;
        anchorTileX = Math.min(anchorTileX, bounds.minTileX);
        anchorTileY = Math.min(anchorTileY, bounds.minTileY);
    }
    return new Blueprint(selected.map(entry => new BlueprintEntry(
        entry.data.type.objectTypeId,
        entry.tileX - anchorTileX,
        entry.tileY - anchorTileY,
        entry.data.direction,
    )));
}

import {Direction} from "@/common/constants.js";
import {rotate} from "@/common/util.js";

export class BlueprintEntry {

    /**
     * @param {number} objectTypeId
     * @param {number} tileX - relative to the blueprint's anchor
     * @param {number} tileY
     * @param {Direction} direction
     */
    constructor(objectTypeId, tileX, tileY, direction) {
        this.objectTypeId = objectTypeId;
        this.tileX = tileX;
        this.tileY = tileY;
        this.direction = direction;
    }
}

/**
 * @typedef {Object} TileBounds
 * @property {number} minTileX
 * @property {number} minTileY
 * @property {number} maxTileX
 * @property {number} maxTileY
 */

/**
 * A blueprint as plain data that holds across loadouts: each entry's type by index into `typeNames`.
 * @typedef {Object} SerializedBlueprint
 * @property {string[]} typeNames
 * @property {number[]} typeIndexes
 * @property {number[]} tileX
 * @property {number[]} tileY
 * @property {Direction[]} directions
 */

/**
 * The anchor tile a blueprint snaps to so its bounds center pins on a fractional tile position.
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} centerTileX the bounds center relative to the anchor
 * @param {number} centerTileY
 * @returns {Point}
 */
export function getBlueprintAnchorAt(tileX, tileY, centerTileX, centerTileY) {
    return {
        x: Math.round(tileX - centerTileX - 0.5),
        y: Math.round(tileY - centerTileY - 0.5),
    };
}

/**
 * A set of objects to place together, held relative to an anchor tile in placement order.
 */
export class Blueprint {

    /**
     * @param {BlueprintEntry[]} entries in placement order
     */
    constructor(entries) {
        /** @type {ReadonlyArray<BlueprintEntry>} */
        this.entries = Object.freeze(Array.from(entries));
    }

    /**
     * Whether the loadout declares every type the blueprint names.
     * @param {SerializedBlueprint} data
     * @param {ModRegistry} modRegistry
     * @returns {boolean}
     */
    static canDeserialize(data, modRegistry) {
        return data.typeNames.every(name => modRegistry.hasObjectTypeByName(name));
    }

    /**
     * @param {SerializedBlueprint} data
     * @param {ModRegistry} modRegistry
     * @returns {Blueprint}
     */
    static deserialize(data, modRegistry) {
        const typeIds = data.typeNames.map(name => modRegistry.getObjectTypeByName(name).objectTypeId);
        return new Blueprint(data.typeIndexes.map((typeIndex, index) => new BlueprintEntry(
            typeIds[typeIndex],
            data.tileX[index],
            data.tileY[index],
            data.directions[index],
        )));
    }

    /**
     * @param {ModRegistry} modRegistry
     * @returns {SerializedBlueprint}
     */
    serialize(modRegistry) {
        const typeNames = [];
        const typeIndexes = [];
        for (const entry of this.entries) {
            const name = modRegistry.getObjectTypeByTypeId(entry.objectTypeId).name;
            let typeIndex = typeNames.indexOf(name);
            if (typeIndex === -1) {
                typeIndex = typeNames.length;
                typeNames.push(name);
            }
            typeIndexes.push(typeIndex);
        }
        return {
            typeNames,
            typeIndexes,
            tileX: this.entries.map(entry => entry.tileX),
            tileY: this.entries.map(entry => entry.tileY),
            directions: this.entries.map(entry => entry.direction),
        };
    }

    /**
     * A copy turned clockwise around the anchor.
     * @param {Direction} rotation
     * @param {ModRegistry} modRegistry
     * @returns {Blueprint}
     */
    rotate(rotation, modRegistry) {
        return new Blueprint(this.entries.map(entry => rotateEntry(entry, rotation, modRegistry.getObjectTypeByTypeId(entry.objectTypeId))));
    }

    /**
     * The box every entry's footprint fits in, relative to the anchor.
     * @param {ModRegistry} modRegistry
     * @returns {TileBounds}
     */
    getBounds(modRegistry) {
        const bounds = {minTileX: Infinity, minTileY: Infinity, maxTileX: -Infinity, maxTileY: -Infinity};
        for (const entry of this.entries) {
            const type = modRegistry.getObjectTypeByTypeId(entry.objectTypeId);
            for (const cell of type.geometry.getTilesByDirection(entry.direction)) {
                bounds.minTileX = Math.min(bounds.minTileX, entry.tileX + cell.x);
                bounds.minTileY = Math.min(bounds.minTileY, entry.tileY + cell.y);
                bounds.maxTileX = Math.max(bounds.maxTileX, entry.tileX + cell.x);
                bounds.maxTileY = Math.max(bounds.maxTileY, entry.tileY + cell.y);
            }
        }
        return bounds;
    }
}

/**
 * @param {BlueprintEntry} entry
 * @param {Direction} turn
 * @param {ObjectType} type
 * @returns {BlueprintEntry}
 */
function rotateEntry(entry, turn, type) {
    const turned = rotate({x: entry.tileX, y: entry.tileY, direction: entry.direction}, turn);
    if (type.directional) {
        return new BlueprintEntry(entry.objectTypeId, turned.x, turned.y, turned.direction);
    }
    // The sim forces a non-directional type to UP, so its origin moves to keep the same cells.
    const corner = type.geometry.getCornerByDirection(turn);
    return new BlueprintEntry(entry.objectTypeId, turned.x + Math.min(0, corner.x), turned.y + Math.min(0, corner.y), Direction.UP);
}

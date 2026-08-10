/**
 * One highlight drawn when inspecting an object. Mods return these from `onInspect`.
 */
export class InspectHighlight {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction - object facing
     * @param {ObjectType} type - picks the texture and footprint
     * @param {boolean} [alt] - use the alternate texture
     */
    constructor(tileX, tileY, direction, type, alt=false) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.direction = direction;
        this.type = type;
        this.alt = alt;
    }
}

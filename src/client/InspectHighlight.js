/**
 * One highlight drawn when inspecting an object. Mods return these from `onInspect`.
 */
export class InspectHighlight {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction - object facing
     * @param {ObjectDefinition} definition - picks the texture and footprint
     * @param {boolean} [alt] - use the alternate texture
     */
    constructor(tileX, tileY, direction, definition, alt=false) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.direction = direction;
        this.definition = definition;
        this.alt = alt;
    }
}

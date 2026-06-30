/**
 * One inspect-hover highlight: an object outlined at a tile, sized/rotated to its geometry. A mod's
 * `onInspect` returns an array of these; the InspectLayer renders each as an `inspect/<geometry>` sprite.
 */
export class InspectHighlight {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction - the object's facing (rotates/sizes the highlight)
     * @param {ObjectDefinition} definition - its geometry picks the inspect texture and the footprint
     * @param {boolean} [alt] - use the alternate texture (a related/secondary highlight)
     */
    constructor(tileX, tileY, direction, definition, alt=false) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.direction = direction;
        this.definition = definition;
        this.alt = alt;
    }
}

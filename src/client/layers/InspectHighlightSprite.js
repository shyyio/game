/**
 * One highlight drawn when inspecting an object. Mods return these from `onInspect`.
 */
export class InspectHighlightSprite {

    /**
     * @param {object} config
     * @param {number} config.tileX
     * @param {number} config.tileY
     * @param {Direction} config.direction - object facing
     * @param {ObjectType} config.type - picks the texture and footprint
     * @param {boolean} [config.alt] - use the alternate texture
     * @param {number} [config.drawHeight] - pixels the highlight sits above its tile, matching an
     *     object drawn off the ground
     */
    constructor({
        tileX,
        tileY,
        direction,
        type,
        alt = false,
        drawHeight = 0,
    }) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.direction = direction;
        this.type = type;
        this.alt = alt;
        this.drawHeight = drawHeight;
    }
}

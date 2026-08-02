/**
 * One item type's render texture, collected at ModRegistry.freeze() from every mod's
 * declaration.itemTextures. The tint recolors a shared desaturated shape so item types sharing
 * a shape stay visually distinct.
 */
export class ItemTextureEntry {

    /**
     * @param {string} texture texture name (e.g. "items/1-gray")
     * @param {number} tint pixi multiply tint, 0xFFFFFF for no tint
     */
    constructor(texture, tint = 0xFFFFFF) {
        this.texture = texture;
        this.tint = tint;
    }
}

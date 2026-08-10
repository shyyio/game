/**
 * One item type's definition, registered into the ItemRegistry at ModRegistry.freeze() from every
 * mod's declaration.items. The tint recolors a shared desaturated shape so item types sharing
 * a shape stay visually distinct.
 */
export class ItemDefinition {

    /**
     * @param {string} name player-visible item name
     * @param {string} texture texture name (e.g. "items/1-gray")
     * @param {number} tint pixi multiply tint, 0xFFFFFF for no tint
     */
    constructor(
        name,
        texture,
        tint = 0xFFFFFF,
    ) {
        this.name = name;
        this.texture = texture;
        this.tint = tint;
    }
}

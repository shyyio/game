/**
 * One frame of an item type's aging: the texture it shows from `fromAge` ticks old on.
 */
export class ItemAgeFrameEntry {

    /**
     * @param {string} texture texture name (e.g. "items/steel0")
     * @param {number} fromAge ticks since the item was made
     */
    constructor(texture, fromAge) {
        this.texture = texture;
        this.fromAge = fromAge;
    }
}

/**
 * One item type's definition, registered into the ItemRegistry at ModRegistry.freeze() from every
 * mod's declaration.items. The tint recolors a shared desaturated shape so item types sharing
 * a shape stay visually distinct.
 */
export class ItemType {

    /**
     * @param {string} name player-visible item name
     * @param {string} texture texture name (e.g. "items/1-gray")
     * @param {number} tint pixi multiply tint, 0xFFFFFF for no tint
     * @param {ItemAgeFrameEntry[]} ageFrames the frames a fresh item cools through, youngest first
     */
    constructor(name, texture, tint = 0xFFFFFF, ageFrames = []) {
        this.name = name;
        this.texture = texture;
        this.tint = tint;
        this.ageFrames = ageFrames;
    }

    /**
     * @returns {boolean} whether the item's texture changes as it ages
     */
    get isAging() {
        return this.ageFrames.length > 0;
    }

    /**
     * @param {number} age ticks since the item was made
     * @returns {boolean} whether the age has reached the last frame, so the look stops changing
     */
    isFullyAged(age) {
        return age >= this.ageFrames[this.ageFrames.length - 1].fromAge;
    }

    /**
     * @param {number} age ticks since the item was made
     * @returns {string} texture name
     */
    getTextureByAge(age) {
        let texture = this.texture;
        for (const frame of this.ageFrames) {
            if (frame.fromAge > age) {
                return texture;
            }
            texture = frame.texture;
        }
        return texture;
    }
}

/**
 * One biome rule: the channel's noise must fall in [min, max] (on the normalized 0-1 scale).
 */
export class NoiseRange {

    /**
     * @param {NoiseChannel} channel
     * @param {number} min
     * @param {number} max
     */
    constructor(channel, min, max) {
        if (!(min <= max)) {
            throw new RangeError(`NoiseRange on "${channel.name}": min ${min} must be <= max ${max}`);
        }
        this.channel = channel;
        this.min = min;
        this.max = max;
    }
}

/**
 * One terrain biome a mod declares: its palette color and the noise ranges that select it. Biomes
 * are tested in registration order and the first match wins; a biome without ranges matches every
 * tile, so the last declared biome must have none. biomeId is positional at ModRegistry.freeze().
 */
export class Biome {

    /**
     * @param {string} name unique across the loadout
     * @param {number} color 0xRRGGBB
     * @param {NoiseRange[]} [ranges] all must hold; none = matches every tile
     */
    constructor(name, color, ranges = []) {
        this.name = name;
        this.color = color;
        this.ranges = ranges;
        this._biomeId = null;
    }

    /**
     * @returns {number}
     */
    get biomeId() {
        if (this._biomeId === null) {
            throw new Error(`Biome "${this.name}" has no biomeId; freeze the ModRegistry first`);
        }
        return this._biomeId;
    }

    /**
     * Called by ModRegistry.freeze(); reassignment to a different id throws.
     * @param {number} biomeId
     * @returns {void}
     */
    _assignBiomeId(biomeId) {
        if (this._biomeId !== null && this._biomeId !== biomeId) {
            throw new Error(`Biome "${this.name}" biomeId reassigned: ${this._biomeId} -> ${biomeId}`);
        }
        this._biomeId = biomeId;
    }
}

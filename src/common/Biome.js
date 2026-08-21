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
 * One kind of ground decoration a biome scatters: a texture placed on a fraction of its tiles.
 */
export class TerrainDetail {

    /**
     * @param {string} texture texture name in the loadout's atlases
     * @param {number} density fraction of the biome's tiles carrying it, in [0, 1]
     * @param {boolean} [tinted] whether the sprite takes the biome's color (grayscale art) or its own
     * @param {number} [scale] sprite scale over the texture's natural size
     */
    constructor(texture, density, tinted = true, scale = 1) {
        if (!(density >= 0 && density <= 1)) {
            throw new RangeError(`TerrainDetail "${texture}": density must be in [0, 1], got ${density}`);
        }
        if (!(scale > 0)) {
            throw new RangeError(`TerrainDetail "${texture}": scale must be > 0, got ${scale}`);
        }
        this.texture = texture;
        this.density = density;
        this.tinted = tinted;
        this.scale = scale;
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
     * @param {number} [shadeStrength] multiplier on the client's per-tile shade variation
     * @param {TerrainDetail[]} [details] decorations scattered over its tiles; densities sum to <= 1
     */
    constructor(name, color, ranges = [], shadeStrength = 1, details = []) {
        if (!(shadeStrength >= 0)) {
            throw new RangeError(`Biome "${name}": shadeStrength must be >= 0, got ${shadeStrength}`);
        }
        let totalDensity = 0;
        for (const detail of details) {
            totalDensity += detail.density;
        }
        if (totalDensity > 1) {
            throw new RangeError(`Biome "${name}": detail densities sum to ${totalDensity}, above 1`);
        }
        this.name = name;
        this.color = color;
        this.ranges = ranges;
        this.shadeStrength = shadeStrength;
        this.details = details;
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

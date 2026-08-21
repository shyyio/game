const DEFAULT_LACUNARITY = 2;
const DEFAULT_PERSISTENCE = 0.5;

/**
 * One terrain quantity (height, humidity, ...) a mod declares: how its noise field is sampled.
 * Registration order across the loadout assigns the channelId at ModRegistry.freeze(); the field
 * itself is seeded by name, so adding a mod never reshuffles another's terrain.
 */
export class NoiseChannel {

    /**
     * @param {string} name unique across the loadout
     * @param {number} frequency tile-to-noise scale; smaller = broader features
     * @param {number} [octaves] fBm layers; 1 = plain simplex
     * @param {number} [lacunarity] frequency multiplier per octave
     * @param {number} [persistence] amplitude multiplier per octave
     */
    constructor(name, frequency, octaves = 1, lacunarity = DEFAULT_LACUNARITY, persistence = DEFAULT_PERSISTENCE) {
        if (!(frequency > 0)) {
            throw new RangeError(`NoiseChannel "${name}": frequency must be > 0, got ${frequency}`);
        }
        if (!Number.isInteger(octaves) || octaves < 1) {
            throw new RangeError(`NoiseChannel "${name}": octaves must be an integer >= 1, got ${octaves}`);
        }
        this.name = name;
        this.frequency = frequency;
        this.octaves = octaves;
        this.lacunarity = lacunarity;
        this.persistence = persistence;
        this._channelId = null;
    }

    /**
     * @returns {number}
     */
    get channelId() {
        if (this._channelId === null) {
            throw new Error(`NoiseChannel "${this.name}" has no channelId; freeze the ModRegistry first`);
        }
        return this._channelId;
    }

    /**
     * Called by ModRegistry.freeze(); reassignment to a different id throws.
     * @param {number} channelId
     * @returns {void}
     */
    _assignChannelId(channelId) {
        if (this._channelId !== null && this._channelId !== channelId) {
            throw new Error(`NoiseChannel "${this.name}" channelId reassigned: ${this._channelId} -> ${channelId}`);
        }
        this._channelId = channelId;
    }
}

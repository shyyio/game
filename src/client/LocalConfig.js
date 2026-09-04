// Local play's own settings, beside its mod list (@/client/LocalLoadout.js).

import {DEFAULT_TICK_MS, WORLD_SEED_MAX} from "@/common/constants.js";

const STORAGE_CONFIG = "spup.local-config";
const CONFIG_KEYS = ["seed", "tickMs"];

export class LocalConfig {

    /**
     * @param {number|null} seed null draws a random seed for a new world
     * @param {number} tickMs
     */
    constructor(seed, tickMs) {
        this.seed = seed;
        this.tickMs = tickMs;
    }

    /**
     * @returns {object}
     */
    toJSON() {
        return {seed: this.seed, tickMs: this.tickMs};
    }

    /**
     * @param {object} json
     * @returns {LocalConfig}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || Array.isArray(json)) {
            throw new Error("A local config must be an object");
        }
        for (const key of Object.keys(json)) {
            if (!CONFIG_KEYS.includes(key)) {
                throw new Error(`Unknown key "${key}" in the local config`);
            }
        }
        let seed = null;
        if (json.seed !== undefined && json.seed !== null) {
            seed = json.seed;
            if (!Number.isInteger(seed) || seed < 0 || seed > WORLD_SEED_MAX) {
                throw new Error(`seed must be an integer from 0 to ${WORLD_SEED_MAX}`);
            }
        }
        let tickMs = DEFAULT_TICK_MS;
        if (json.tickMs !== undefined) {
            tickMs = json.tickMs;
            if (!Number.isInteger(tickMs) || tickMs < 1) {
                throw new Error("tickMs must be a positive integer");
            }
        }
        return new LocalConfig(seed, tickMs);
    }
}

/**
 * @returns {LocalConfig} the stored config, or the defaults when nothing was set
 */
export function readLocalConfig() {
    const stored = localStorage.getItem(STORAGE_CONFIG);
    if (stored === null) {
        return LocalConfig.parse({});
    }
    return LocalConfig.parse(JSON.parse(stored));
}

/**
 * @param {LocalConfig} config
 * @returns {void}
 */
export function writeLocalConfig(config) {
    localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config.toJSON()));
}

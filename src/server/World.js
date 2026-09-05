import {existsSync, unlinkSync} from "node:fs";
import {ModRegistry} from "@/common/ModRegistry.js";
import {conversionLosses, convertSnapshot} from "@/sim/snapshotConversion.js";
import {simLoadout} from "@/mods/loadout.js";
import {MOD_DIRS} from "@/mods/modDirs.js";
import {GAME_VERSION} from "@/common/constants.js";
import {Game} from "@/sim/Game.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {NodeMetricsStore} from "@/server/NodeMetricsStore.js";
import {ModCache} from "@/server/ModCache.js";
import {builtInModList, externalModList, modListJson} from "@/server/modList.js";
import {loadPackagedMods} from "@/server/ModLoader.js";
import {randomWorldSeed} from "@/common/WorldNoise.js";

/**
 * One booted world: the mod registry, the game over its stores, and what serves its mods. A config
 * change that touches any of these boots a new one and closes the old.
 */
export class World {

    /**
     * @param {object} parts
     * @param {Game} parts.game
     * @param {GameAPI} parts.api
     * @param {string} parts.modListJson the mod list it serves joining clients
     * @param {ModLockfile} parts.lockfile the external mods it booted with, empty when it runs none
     * @param {boolean} parts.loaded whether a saved world was loaded rather than started fresh
     */
    constructor({game, api, modListJson, lockfile, loaded}) {
        this.game = game;
        this.api = api;
        this.modListJson = modListJson;
        this.lockfile = lockfile;
        this.loaded = loaded;
    }

    /**
     * @returns {Promise<void>}
     */
    save() {
        return this.game.save();
    }

    /**
     * What moving this world onto `loadout` would lose, named for the operator.
     * @param {object} snapshot this world as {@link takeSnapshot} left it
     * @param {{typeNames: string[], itemTypes: Set<number>}} loadout
     * @returns {{objects: Array<{name: string, count: number}>, items: Array<{name: string, count: number}>}}
     */
    conversionLosses(snapshot, loadout) {
        const losses = conversionLosses(snapshot, loadout);
        const items = this.game.modRegistry.items;
        return {
            objects: Array.from(losses.objects, ([name, count]) => ({name, count})),
            items: Array.from(losses.items, ([itemType, count]) => ({name: items.definitionFor(itemType).name, count})),
        };
    }

    /**
     * Deletes every object of a type `loadout` lacks, then serializes; {@link boot} converts the
     * result onto the new loadout.
     * @param {{typeNames: string[], itemTypes: Set<number>}} loadout
     * @returns {object}
     */
    snapshotForConversion(loadout) {
        const kept = new Set(loadout.typeNames);
        for (const type of this.game.modRegistry.objectTypes) {
            if (!kept.has(type.name)) {
                this.game.simEngine.removeObjectsOfType(type.typeId);
            }
        }
        return this.game.serialize();
    }

    /**
     * The world as it stands, for putting it back when a conversion fails.
     * @returns {object}
     */
    takeSnapshot() {
        return this.game.serialize();
    }

    /**
     * Puts `snapshot` back under this world: the objects a failed conversion deleted return, and the
     * registry takes back the typeIds the other loadout's freeze stamped onto the shared types.
     * @param {object} snapshot
     * @returns {void}
     */
    restore(snapshot) {
        this.game.modRegistry.claimTypeIds();
        this.game.loadSnapshot(snapshot);
    }

    /**
     * Saves and releases the databases.
     * @returns {Promise<void>}
     */
    async close() {
        await Promise.all([this.game.save(), this.game.metrics.flush()]);
        await this.game.metrics.close();
        this.game.saveStore.close();
    }

    /**
     * Releases the databases without saving, for a world about to be deleted.
     * @returns {Promise<void>}
     */
    async discard() {
        await this.game.metrics.close();
        this.game.saveStore.close();
    }

    /**
     * Deletes a config's world and metrics databases, journals included; absent files are fine.
     * @param {ServerConfig} config
     * @returns {void}
     */
    static deleteFiles(config) {
        for (const path of [config.db, config.metricsDb]) {
            for (const suffix of ["", "-wal", "-shm", "-journal"]) {
                if (existsSync(`${path}${suffix}`)) {
                    unlinkSync(`${path}${suffix}`);
                }
            }
        }
    }

    /**
     * The packages `config` runs: the loadout compiled into this build, then the external mods its
     * config names, downloaded into the cache and checked against the hashes it records. Order is
     * what assigns the positional ids, so the build's own mods always come first.
     * @private
     * @param {ServerConfig} config
     * @returns {Promise<{packages: ModPackage[], modListJson: string}>}
     */
    static async _packagesOf(config) {
        const packages = simLoadout();
        const entries = builtInModList(MOD_DIRS, GAME_VERSION);
        if (config.mods === null) {
            return {packages, modListJson: modListJson(entries)};
        }
        const cache = new ModCache(config.modsCache);
        const downloaded = await cache.populate(config.lockfile);
        const loaded = await loadPackagedMods(config.lockfile, cache);
        console.log(`Loaded ${loaded.packages.length} external mods (${downloaded} newly downloaded)`);
        return {
            packages: packages.concat(loaded.packages),
            modListJson: modListJson(entries.concat(externalModList(loaded.mods))),
        };
    }

    /**
     * What `config`'s mods declare, read off the packages without freezing a registry (a freeze
     * renumbers the object types the running world shares).
     * @param {ServerConfig} config
     * @returns {Promise<{typeNames: string[], itemTypes: Set<number>}>}
     */
    static async loadoutOf(config) {
        const {packages} = await World._packagesOf(config);
        const typeNames = [];
        const itemTypes = new Set();
        for (const pkg of packages) {
            for (const type of pkg.declaration.objectTypes) {
                typeNames.push(type.name);
            }
            for (const category of pkg.declaration.items) {
                for (const itemType of Object.keys(category.items)) {
                    itemTypes.add(Number(itemType));
                }
            }
        }
        return {typeNames, itemTypes};
    }

    /**
     * Boots a world on `config`: from `snapshot` when given (another loadout's, converted here),
     * from its saved files otherwise. Throws on a save the loadout cannot read, and on a seed that
     * differs from a saved world's.
     * @param {ServerConfig} config
     * @param {object|null} [snapshot]
     * @returns {Promise<World>}
     */
    static async boot(config, snapshot = null) {
        const {packages, modListJson: modList} = await World._packagesOf(config);
        const lockfile = config.lockfile;
        const modRegistry = new ModRegistry();
        for (const pkg of packages) {
            modRegistry.register(pkg);
        }
        modRegistry.freeze();

        const seed = config.seed === null ? randomWorldSeed() : config.seed;
        const game = new Game(
            modRegistry, new GameEngine(modRegistry), new NodeSaveStore(config.db), new NodeMetricsStore(config.metricsDb),
            config.tickMs, seed,
        );
        await game.init();
        let loaded;
        try {
            if (snapshot === null) {
                loaded = await game.load();
            } else {
                game.loadSnapshot(convertSnapshot(snapshot, game.simEngine.snapshots.loadout, game.simEngine.components.defs));
                await game.save();
                loaded = true;
            }
        } catch (error) {
            await game.metrics.close();
            game.saveStore.close();
            throw new Error(`${config.db} is incompatible with the current build: ${error.message}`);
        }
        if (snapshot !== null) {
            console.log(`Converted world onto ${modRegistry.modNames.length} mods (seed ${game.seed})`);
        } else if (loaded) {
            console.log(`Loaded world from ${config.db} (seed ${game.seed})`);
        } else {
            console.log(`Fresh world; saving to ${config.db} (seed ${game.seed})`);
        }
        if (config.seed !== null && game.seed !== config.seed) {
            throw new Error(`The configured seed ${config.seed} does not match the saved world seed ${game.seed}`);
        }
        return new World({game, api: new GameAPI(game), modListJson: modList, lockfile, loaded});
    }
}

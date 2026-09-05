import {JwksVerifier} from "@/server/JwksVerifier.js";
import {ServerConfig} from "@/common/ServerConfig.js";
import {World} from "@/server/World.js";
import {resolveConfigPaths} from "@/server/serverConfigFile.js";

// What only a restart can change: the listen socket.
export const RESTART_FIELDS = ["host", "port"];

// What a world is built on; a change here boots a new one from the files.
const WORLD_FIELDS = ["seed", "db", "metricsDb", "modsCache"];

/**
 * A mod change that would lose objects or items, waiting for the operator to confirm it.
 */
export class LoadoutChangeRefused extends Error {

    /**
     * @param {{objects: Array<{name: string, count: number}>, items: Array<{name: string, count: number}>}} losses
     */
    constructor(losses) {
        super("Changing these mods would lose part of the world; confirm the conversion");
        this.losses = losses;
    }
}

/**
 * @param {string} url
 * @returns {Promise<JwksVerifier>} loaded
 */
async function loadJwksVerifier(url) {
    const verifier = new JwksVerifier(url);
    await verifier.load();
    return verifier;
}

/**
 * The running process's view of its config: the world under the game server, its tick and save
 * loops, and the parts of the server a saved config changes in place.
 */
export class ServerRuntime {

    /**
     * @param {object} options
     * @param {World} options.world the world the process booted
     * @param {GameServer} options.gameServer
     * @param {ServerConfig} options.config what the process booted with, paths as written
     * @param {string} options.baseDir what a relative path in the config counts from
     * @param {string[]} [options.overridden] fields a command-line flag set; a save never moves them
     * @param {function(string): Promise<object>} [options.jwksVerifierFor] loads a verifier for an auth server
     * @param {function(ServerConfig, object=): Promise<World>} [options.bootWorld]
     * @param {function(ServerConfig): Promise<object>} [options.loadoutFor] what a config's mods declare
     * @param {function(ServerConfig): void} [options.deleteWorldFiles]
     * @param {function(Error): void} options.onTickError
     * @param {function(Error): void} options.onSaveError
     */
    constructor({
            world,
            gameServer,
            config,
            baseDir,
            overridden = [],
            jwksVerifierFor = loadJwksVerifier,
            bootWorld = World.boot,
            loadoutFor = World.loadoutOf,
            deleteWorldFiles = World.deleteFiles,
            onTickError,
            onSaveError}) {
        this._world = world;
        this._gameServer = gameServer;
        this._running = config;
        this._baseDir = baseDir;
        this._overridden = overridden;
        this._jwksVerifierFor = jwksVerifierFor;
        this._bootWorld = bootWorld;
        this._loadoutFor = loadoutFor;
        this._deleteWorldFiles = deleteWorldFiles;
        this._onTickError = onTickError;
        this._onSaveError = onSaveError;
        this._tickInterval = null;
        this._saveInterval = null;
    }

    /**
     * @returns {ServerConfig} what is in effect now
     */
    get running() {
        return this._running;
    }

    /**
     * @returns {World}
     */
    get world() {
        return this._world;
    }

    /**
     * @returns {string} what a relative path in the config counts from
     */
    get baseDir() {
        return this._baseDir;
    }

    /**
     * @param {ServerConfig} config
     * @returns {ServerConfig} config with its paths made absolute, as the worlds use them
     */
    resolvePaths(config) {
        return resolveConfigPaths(config, this._baseDir);
    }

    /**
     * @returns {void}
     */
    start() {
        this._armTick();
        this._armSave();
    }

    /**
     * @returns {void}
     */
    stop() {
        clearInterval(this._tickInterval);
        clearInterval(this._saveInterval);
        this._tickInterval = null;
        this._saveInterval = null;
    }

    /**
     * Puts every field of `config` but the listen socket into effect: the world converted to new
     * mods, a new world when it is built on other files, live changes otherwise. Throws, changing
     * nothing, when a mod change would lose part of the world and `convert` is not set, and when
     * a new world fails to boot.
     * @param {ServerConfig} config
     * @param {{convert: boolean}} [options] convert: the operator has seen the losses and agreed
     * @returns {Promise<string[]>} the changed fields only a restart applies
     */
    async apply(config, {convert = false} = {}) {
        const restart = this._restartFields(config);
        const next = this._withHeldFieldsKept(config);
        const changed = this._running.diff(next);
        const verifier = await this._verifierFor(next, changed);
        if (changed.includes("mods")) {
            const loadout = await this._loadoutFor(this.resolvePaths(next));
            // One snapshot serves both: what the losses are counted from is what a failed boot
            // restores.
            const before = this._world.takeSnapshot();
            const losses = this._world.conversionLosses(before, loadout);
            if (!convert && (losses.objects.length > 0 || losses.items.length > 0)) {
                throw new LoadoutChangeRefused(losses);
            }
            await this._convertWorld(next, loadout, before);
        } else if (changed.some(key => WORLD_FIELDS.includes(key))) {
            await this._swapWorld(next);
        } else if (changed.includes("tickMs")) {
            this._world.game.setTickMs(next.tickMs);
        }
        this._applyLive(next, changed, verifier);
        return restart;
    }

    /**
     * Throws the current world away unsaved, deletes its files, and boots a fresh one on `config`,
     * seed and mods included. Should that world fail to boot, a fresh one on the previous config
     * takes its place and the error is rethrown.
     * @param {ServerConfig} config
     * @returns {Promise<string[]>} the changed fields only a restart applies
     */
    async resetWorld(config) {
        const restart = this._restartFields(config);
        const next = this._withHeldFieldsKept(config);
        const changed = this._running.diff(next);
        const verifier = await this._verifierFor(next, changed);
        const armed = this._tickInterval !== null;
        this.stop();
        try {
            await this._world.discard();
            // The files of the world about to boot, so a reset onto another save resets that one and
            // leaves the save it came from alone.
            this._deleteWorldFiles(this.resolvePaths(next));
            this._installWorld(await this._bootWorld(this.resolvePaths(next)), armed);
        } catch (error) {
            this._installWorld(await this._bootWorld(this.resolvePaths(this._running)), armed);
            throw error;
        }
        this._applyLive(next, changed, verifier);
        return restart;
    }

    /**
     * The verifier `next` needs, loaded before anything changes so an auth server that cannot be
     * reached leaves the world and the config as they were.
     * @private
     * @param {ServerConfig} next
     * @param {string[]} changed
     * @returns {Promise<object|null>} null when the auth server is the one already in use
     */
    async _verifierFor(next, changed) {
        if (!changed.includes("authServer")) {
            return null;
        }
        return await this._jwksVerifierFor(next.authServer);
    }

    /**
     * @private
     * @param {ServerConfig} config
     * @returns {ServerConfig} config, with the fields a save cannot move as they run now
     */
    _withHeldFieldsKept(config) {
        const json = config.toJSON();
        for (const key of RESTART_FIELDS.concat(this._overridden)) {
            json[key] = this._running[key];
        }
        return ServerConfig.parse(json);
    }

    /**
     * @private
     * @param {ServerConfig} config what the operator asked for
     * @returns {string[]} the fields of it only a restart applies
     */
    _restartFields(config) {
        return RESTART_FIELDS.filter(key => this._running[key] !== config[key]);
    }

    /**
     * Puts the parts of `next` the game server and the loops read into effect.
     * @private
     * @param {ServerConfig} next already holding the current restart-only fields
     * @param {string[]} changed the fields that differ from what ran before
     * @param {object|null} verifier the auth server's, when it changed
     * @returns {void}
     */
    _applyLive(next, changed, verifier) {
        if (verifier !== null) {
            this._gameServer.setJwksVerifier(verifier);
        }
        this._gameServer.setName(next.name);
        this._gameServer.setOrigin(next.origin);
        this._running = next;
        if (this._tickInterval !== null && (changed.includes("tickMs") || changed.includes("saveMs"))) {
            this.stop();
            this.start();
        }
    }

    /**
     * @private
     * @param {World} world
     * @param {boolean} armed whether the loops were running
     * @returns {void}
     */
    _installWorld(world, armed) {
        this._world = world;
        this._gameServer.setWorld(world);
        if (armed) {
            this.start();
        }
    }

    /**
     * Carries the world over to `config`'s mods: objects of vanished types are deleted in place,
     * the snapshot boots a world on the new loadout, and the old one is dropped unsaved (its state
     * lives on in the new world). A new world that fails to boot puts the old one back as it was.
     * @private
     * @param {ServerConfig} config
     * @param {object} loadout what config's mods declare
     * @param {object} before the world as it stands, for putting it back
     * @returns {Promise<void>}
     */
    async _convertWorld(config, loadout, before) {
        const armed = this._tickInterval !== null;
        this.stop();
        let next;
        try {
            next = await this._bootWorld(this.resolvePaths(config), this._world.snapshotForConversion(loadout));
        } catch (error) {
            this._world.restore(before);
            if (armed) {
                this.start();
            }
            throw error;
        }
        const old = this._world;
        this._installWorld(next, armed);
        await old.discard();
    }

    /**
     * Boots a world on `config` and puts it under the server, closing the old one; the old world
     * stays when the new one fails to boot.
     * @private
     * @param {ServerConfig} config
     * @returns {Promise<void>}
     */
    async _swapWorld(config) {
        const armed = this._tickInterval !== null;
        this.stop();
        let next;
        try {
            await this._world.save();
            next = await this._bootWorld(this.resolvePaths(config));
        } catch (error) {
            if (armed) {
                this.start();
            }
            throw error;
        }
        const old = this._world;
        this._installWorld(next, armed);
        await old.close();
    }

    /**
     * @private
     * @returns {void}
     */
    _armTick() {
        this._tickInterval = setInterval(() => {
            try {
                this._world.game.runTick();
            } catch (error) {
                // Stop ticking first: a broken sim would throw again on every interval while the
                // error is being reported.
                this.stop();
                this._onTickError(error);
            }
        }, this._running.tickMs);
    }

    /**
     * @private
     * @returns {void}
     */
    _armSave() {
        this._saveInterval = setInterval(() => {
            this._world.save().catch(error => {
                this._onSaveError(error);
            });
        }, this._running.saveMs);
    }
}

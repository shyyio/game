import {test, mock} from "node:test";
import assert from "node:assert/strict";
import {makeGame} from "@/test/ecsSim.js";
import {ServerConfig} from "@/common/ServerConfig.js";
import {LoadoutChangeRefused, ServerRuntime} from "@/server/ServerRuntime.js";
import {GameSettingsKey} from "@/common/constants.js";

/**
 * A GameServer that only records what the runtime hands it.
 */
class FakeGameServer {

    constructor() {
        this.name = "";
        this.origin = "";
        this.jwksVerifier = null;
        this.world = null;
    }

    /** @param {object} world */
    setWorld(world) {
        this.world = world;
    }

    /** @param {string} name */
    setName(name) {
        this.name = name;
    }

    /** @param {string} origin */
    setOrigin(origin) {
        this.origin = origin;
    }

    /** @param {object} verifier */
    setJwksVerifier(verifier) {
        this.jwksVerifier = verifier;
    }
}

/**
 * @param {object} t
 * @param {object} [json] config fields
 * @returns {Promise<{runtime: ServerRuntime, game: Game, gameServer: FakeGameServer, loaded: string[]}>}
 */
async function makeRuntime(t, json = {}, baseDir = process.cwd(), overridden = []) {
    const game = await makeGame();
    const gameServer = new FakeGameServer();
    const loaded = [];
    const booted = [];
    const deleted = [];
    const loadouts = [];
    const world = new FakeWorld(game);
    gameServer.setWorld(world);
    const runtime = new ServerRuntime({
        world,
        gameServer,
        config: ServerConfig.parse(json),
        baseDir,
        overridden,
        jwksVerifierFor: async url => {
            if (url.includes("unreachable")) {
                throw new Error("no jwks");
            }
            loaded.push(url);
            return {url};
        },
        bootWorld: async (config, snapshot = null) => {
            booted.push(Object.assign(config, {snapshot}));
            if (config.db.endsWith("broken.sqlite3")) {
                throw new Error("broken");
            }
            return new FakeWorld(await makeGame());
        },
        loadoutFor: async config => {
            loadouts.push(config);
            return {typeNames: config.lockfile.mods.map(mod => `${mod.name}-type`), itemTypes: new Set()};
        },
        deleteWorldFiles: config => {
            if (config.db.endsWith("locked.sqlite3")) {
                throw new Error("locked");
            }
            deleted.push(config);
        },
        onTickError: () => {},
        onSaveError: () => {},
    });
    t.after(() => runtime.stop());
    return {runtime, game, gameServer, loaded, booted, deleted, loadouts, world};
}

/**
 * A booted world that only records being closed.
 */
class FakeWorld {

    /** @param {Game} game */
    constructor(game) {
        this.game = game;
        this.saved = 0;
        this.closed = false;
        this.discarded = false;
        this.losses = {objects: [], items: []};
        this.convertedTo = null;
        this.snapshot = {converted: true};
        this.restored = null;
    }

    /** @returns {object} */
    takeSnapshot() {
        return {whole: true};
    }

    /**
     * @param {object} snapshot
     * @returns {void}
     */
    restore(snapshot) {
        this.restored = snapshot;
        this.convertedTo = null;
    }

    /**
     * @param {object} snapshot
     * @param {object} loadout
     * @returns {object}
     */
    conversionLosses(snapshot, loadout) {
        return this.losses;
    }

    /**
     * @param {object} loadout
     * @returns {object}
     */
    snapshotForConversion(loadout) {
        this.convertedTo = loadout;
        return this.snapshot;
    }

    /** @returns {Promise<void>} */
    async save() {
        this.saved += 1;
    }

    /** @returns {Promise<void>} */
    async discard() {
        this.discarded = true;
    }

    /** @returns {Promise<void>} */
    async close() {
        this.closed = true;
    }
}

test("applying a config swaps what runs live and names the rest for a restart", async (t) => {
    const {runtime, game, gameServer, loaded} = await makeRuntime(t, {name: "Old", tickMs: 600});
    const next = ServerConfig.parse({
        name: "New", origin: "wss://x:443", authServer: "https://auth.x", tickMs: 300, saveMs: 5, port: 1,
    });

    const restart = await runtime.apply(next);

    assert.deepEqual(restart, ["port"]);
    assert.equal(gameServer.name, "New");
    assert.equal(gameServer.origin, "wss://x:443");
    assert.deepEqual(loaded, ["https://auth.x"]);
    assert.deepEqual(gameServer.jwksVerifier, {url: "https://auth.x"});
    assert.equal(game.gameSettings.get(GameSettingsKey.TICK_MS), 300);
    assert.equal(runtime.running.name, "New");
    assert.equal(runtime.running.tickMs, 300);
    assert.equal(runtime.running.port, 27500);
});

test("a change to what the world is built on boots a new world under the server and closes the old", async (t) => {
    const {runtime, gameServer, booted, world} = await makeRuntime(t);
    const next = ServerConfig.parse({db: "other.sqlite3", tickMs: 300});

    await runtime.apply(next);

    assert.equal(booted.length, 1);
    assert.ok(booted[0].db.endsWith("/other.sqlite3"));
    assert.equal(booted[0].tickMs, 300);
    assert.notEqual(gameServer.world, world);
    assert.equal(runtime.world, gameServer.world);
    assert.equal(world.saved, 1);
    assert.equal(world.closed, true);
});

test("a live-only change keeps the world", async (t) => {
    const {runtime, booted, world} = await makeRuntime(t);
    await runtime.apply(ServerConfig.parse({name: "Other"}));
    assert.deepEqual(booted, []);
    assert.equal(world.closed, false);
});

test("a world that fails to boot leaves the old one running and reports why", async (t) => {
    const {runtime, gameServer, world} = await makeRuntime(t);
    await assert.rejects(runtime.apply(ServerConfig.parse({db: "broken.sqlite3"})), /broken/);
    assert.equal(gameServer.world, world);
    assert.equal(world.closed, false);
    assert.equal(runtime.running.db, "world.sqlite3");
});

test("a reset discards the world unsaved, deletes its files, and boots fresh on the new config", async (t) => {
    const {runtime, gameServer, booted, deleted, world} = await makeRuntime(t, {name: "Old"});
    const next = ServerConfig.parse({name: "New", seed: 4, tickMs: 300});

    const restart = await runtime.resetWorld(next);

    assert.deepEqual(restart, []);
    assert.equal(world.saved, 0);
    assert.equal(world.discarded, true);
    assert.ok(deleted[0].db.endsWith("/world.sqlite3"));
    assert.equal(booted[0].seed, 4);
    assert.equal(gameServer.world, runtime.world);
    assert.notEqual(gameServer.world, world);
    assert.equal(gameServer.name, "New");
    assert.equal(runtime.running.seed, 4);
    assert.equal(runtime.running.tickMs, 300);
});

test("a reset whose new world fails to boot comes back fresh on the previous config and reports why", async (t) => {
    const {runtime, gameServer, booted, world} = await makeRuntime(t, {name: "Old"});
    await assert.rejects(runtime.resetWorld(ServerConfig.parse({db: "broken.sqlite3"})), /broken/);
    assert.equal(world.discarded, true);
    assert.equal(booted.length, 2);
    assert.ok(booted[1].db.endsWith("/world.sqlite3"));
    assert.notEqual(gameServer.world, world);
    assert.equal(runtime.running.name, "Old");
});

const PIN = {url: "https://mods.example/widgets/1.0.0/", name: "widgets", version: "1.0.0", integrity: {"mod.json": `sha256-${"a1".repeat(32)}`}};

test("a mod change converts the world: losses are refused until confirmed, then the world carries over", async (t) => {
    const {runtime, gameServer, booted, world} = await makeRuntime(t);
    world.losses = {objects: [{name: "Gadget", count: 2}], items: []};
    const next = ServerConfig.parse({mods: [PIN]});

    await assert.rejects(runtime.apply(next), error => {
        assert.ok(error instanceof LoadoutChangeRefused);
        assert.deepEqual(error.losses, world.losses);
        return true;
    });
    assert.equal(gameServer.world, world);
    assert.deepEqual(booted, []);

    await runtime.apply(next, {convert: true});
    assert.equal(world.convertedTo.typeNames[0], "widgets-type");
    assert.equal(booted[0].snapshot, world.snapshot);
    assert.equal(world.discarded, true);
    assert.equal(world.closed, false);
    assert.notEqual(gameServer.world, world);
    assert.deepEqual(runtime.running.lockfile.mods.map(mod => mod.name), ["widgets"]);
});

test("a mod change that loses nothing converts without confirmation", async (t) => {
    const {runtime, booted, world} = await makeRuntime(t);
    await runtime.apply(ServerConfig.parse({mods: [PIN]}));
    assert.equal(booted[0].snapshot, world.snapshot);
});

test("worlds boot and reset on paths resolved from the config's directory, while the running config keeps them as written", async (t) => {
    const {runtime, booted, deleted} = await makeRuntime(t, {}, "/srv/game");
    await runtime.apply(ServerConfig.parse({db: "other.sqlite3", modsCache: "/opt/cache"}));
    assert.equal(booted[0].db, "/srv/game/other.sqlite3");
    assert.equal(booted[0].modsCache, "/opt/cache");
    assert.equal(runtime.running.db, "other.sqlite3");
    await runtime.resetWorld(ServerConfig.parse({db: "other.sqlite3", modsCache: "/opt/cache"}));
    assert.equal(deleted[0].db, "/srv/game/other.sqlite3");
    assert.equal(runtime.resolvePaths(runtime.running).metricsDb, "/srv/game/metrics.sqlite3");
});

test("a mod change whose new world fails to boot puts the old world back as it was", async (t) => {
    const {runtime, gameServer, world} = await makeRuntime(t);
    await assert.rejects(runtime.apply(ServerConfig.parse({mods: [PIN], db: "broken.sqlite3"})), /broken/);
    assert.deepEqual(world.restored, {whole: true});
    assert.equal(world.convertedTo, null, "every object the conversion deleted is back");
    assert.equal(gameServer.world, world);
    assert.equal(world.discarded, false);
});

test("a reset onto another save resets that one and leaves the previous save alone", async (t) => {
    const {runtime, booted, deleted} = await makeRuntime(t, {}, "/srv/game");
    await runtime.resetWorld(ServerConfig.parse({db: "archive.sqlite3"}));
    assert.deepEqual(deleted.map(config => config.db), ["/srv/game/archive.sqlite3"]);
    assert.equal(booted[0].db, "/srv/game/archive.sqlite3");
});

test("a field the command line set keeps its running value through a save", async (t) => {
    const {runtime, booted} = await makeRuntime(t, {}, "/srv/game", ["db"]);
    const restart = await runtime.apply(ServerConfig.parse({db: "other.sqlite3", name: "New"}));
    assert.deepEqual(restart, []);
    assert.deepEqual(booted, [], "the world stays on the database the flag chose");
    assert.equal(runtime.running.db, "world.sqlite3");
    assert.equal(runtime.running.name, "New");
});

test("the loadout a mod change is measured against is read with the config's paths resolved", async (t) => {
    const {runtime, loadouts} = await makeRuntime(t, {}, "/srv/game");
    await runtime.apply(ServerConfig.parse({mods: [PIN], modsCache: "cache"}));
    assert.deepEqual(loadouts.map(config => config.modsCache), ["/srv/game/cache"]);
});

test("a reset whose files cannot be deleted comes back running on the previous config", async (t) => {
    const {runtime, gameServer, world} = await makeRuntime(t, {name: "Old"});
    runtime.start();
    await assert.rejects(runtime.resetWorld(ServerConfig.parse({db: "locked.sqlite3"})), /locked/);
    assert.notEqual(gameServer.world, world);
    assert.equal(runtime.running.name, "Old");
    assert.equal(gameServer.world.ticking, undefined);
    await runtime.apply(ServerConfig.parse({name: "Later"}));
    assert.equal(runtime.running.name, "Later", "the runtime still takes changes");
});

test("an auth server that cannot be reached changes nothing", async (t) => {
    const {runtime, gameServer, booted, world} = await makeRuntime(t, {name: "Old"});
    await assert.rejects(
        runtime.apply(ServerConfig.parse({name: "New", db: "other.sqlite3", authServer: "https://unreachable"})),
        /no jwks/,
    );
    assert.deepEqual(booted, []);
    assert.equal(gameServer.world, world);
    assert.equal(gameServer.name, "");
    assert.equal(runtime.running.name, "Old");
});

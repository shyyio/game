import {test} from "node:test";
import assert from "node:assert/strict";
import {ecsModRegistry, makeGameEngine} from "@/test/ecsSim.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {migrateSnapshot} from "@/common/saveMigrations.js";
import {assertWorldSeed, randomWorldSeed} from "@/common/WorldNoise.js";
import {DEFAULT_TICK_MS, GameSettingsKey, WORLD_SEED_MAX} from "@/common/constants.js";

/**
 * @param {NodeSaveStore} saveStore
 * @param {number} seed
 * @returns {Promise<Game>}
 */
async function makeSeededGame(saveStore, seed) {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry), saveStore, undefined, DEFAULT_TICK_MS, seed);
    await game.init();
    return game;
}

test("assertWorldSeed accepts non-negative int32 only", () => {
    assert.doesNotThrow(() => assertWorldSeed(0));
    assert.doesNotThrow(() => assertWorldSeed(WORLD_SEED_MAX));
    for (const bad of [-1, WORLD_SEED_MAX + 1, 1.5, NaN, "7", undefined]) {
        assert.throws(() => assertWorldSeed(bad), RangeError);
    }
});

test("randomWorldSeed draws a valid seed", () => {
    for (let i = 0; i < 100; i++) {
        assert.doesNotThrow(() => assertWorldSeed(randomWorldSeed()));
    }
});

test("Game rejects an invalid seed", () => {
    const modRegistry = ecsModRegistry();
    assert.throws(
        () => new Game(modRegistry, new GameEngine(modRegistry), undefined, undefined, DEFAULT_TICK_MS, -1),
        RangeError,
    );
});

test("a fresh world publishes its seed as a game setting", async () => {
    const game = await makeSeededGame(undefined, 12345);
    assert.equal(game.seed, 12345);
    assert.equal(game.gameSettings.get(GameSettingsKey.SEED), 12345);
});

test("the seed survives save and load, replacing the fresh-world seed", async () => {
    const store = new NodeSaveStore(":memory:");
    const saved = await makeSeededGame(store, 777);
    await saved.save();

    const loaded = await makeSeededGame(store, 1);
    assert.equal(await loaded.load(), true);
    assert.equal(loaded.seed, 777);
    assert.equal(loaded.gameSettings.get(GameSettingsKey.SEED), 777);
});

test("a format-1 save migrates to seed 0", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 1;
    delete snapshot.globals.seed;

    const migrated = migrateSnapshot(snapshot);
    assert.equal(migrated.globals.seed, 0);

    const restored = await makeGameEngine();
    restored.seed = 5;
    restored.snapshots.deserialize(migrated);
    assert.equal(restored.seed, 0);
});

test("game.noise follows the seed through load", async () => {
    const store = new NodeSaveStore(":memory:");
    const saved = await makeSeededGame(store, 4242);
    await saved.save();

    const loaded = await makeSeededGame(store, 1);
    await loaded.load();
    assert.equal(loaded.noise.seed, 4242);
    assert.equal(loaded.noise.channels, loaded.modRegistry.noiseChannels);
});

test("game.terrain classifies the standard loadout's tiles", async () => {
    const game = await makeSeededGame(undefined, 31337);
    assert.equal(game.terrain.noise, game.noise);
    assert.ok(game.modRegistry.biomes.length > 0);
    const bake = game.terrain.bakeChunk(0);
    assert.ok(bake.biomes.every(biomeId => biomeId < game.modRegistry.biomes.length));
});

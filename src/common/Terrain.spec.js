import {test} from "node:test";
import assert from "node:assert/strict";
import {Terrain, SHADE_CHANNEL, BLEND_LEVELS, BLEND_WIDTH, OVERWORLD_CELLS_PER_AXIS, OVERWORLD_CELL_TILES} from "@/common/Terrain.js";
import {WorldNoise} from "@/common/WorldNoise.js";
import {NoiseChannel} from "@/common/NoiseChannel.js";
import {Biome, NoiseRange} from "@/common/Biome.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

class TerrainDeclaration extends AbstractModDeclaration {

    /**
     * @param {string} name
     * @param {NoiseChannel[]} channels
     * @param {Biome[]} biomes
     */
    constructor(name, channels, biomes) {
        super();
        this._name = name;
        this._channels = channels;
        this._biomes = biomes;
    }

    get name() {
        return this._name;
    }

    get noiseChannels() {
        return this._channels;
    }

    get biomes() {
        return this._biomes;
    }
}

/**
 * @param {NoiseChannel[]} channels
 * @param {Biome[]} biomes
 * @returns {ModRegistry} frozen
 */
function freezeLoadout(channels, biomes) {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new TerrainDeclaration("A", channels, biomes)));
    registry.freeze();
    return registry;
}

/**
 * @returns {ModRegistry} a height/humidity loadout with three biomes
 */
function standardLoadout() {
    const height = new NoiseChannel("height", 0.01, 3);
    const humidity = new NoiseChannel("humidity", 0.004);
    return freezeLoadout([height, humidity], [
        new Biome("peak", 0xffffff, [new NoiseRange(height, 0.7, 1)]),
        new Biome("dry", 0xcccc88, [new NoiseRange(humidity, 0, 0.4)]),
        new Biome("grass", 0x88cc88),
    ]);
}

test("freeze assigns biomeIds in order and validates names, channels, fallback", () => {
    const registry = standardLoadout();
    assert.deepEqual(registry.biomes.map(biome => biome.biomeId), [0, 1, 2]);

    const height = new NoiseChannel("height", 0.01);
    assert.throws(
        () => freezeLoadout([height], [new Biome("a", 0, [new NoiseRange(height, 0, 1)]), new Biome("a", 0)]),
        /Duplicate biome "a"/,
    );
    const stray = new NoiseChannel("stray", 0.01);
    assert.throws(
        () => freezeLoadout([height], [new Biome("a", 0, [new NoiseRange(stray, 0, 1)]), new Biome("b", 0)]),
        /undeclared noise channel "stray"/,
    );
    assert.throws(
        () => freezeLoadout([height], [new Biome("a", 0, [new NoiseRange(height, 0, 0.5)])]),
        /must be unconditional/,
    );
    assert.throws(() => new NoiseRange(height, 0.6, 0.5), RangeError);
    assert.throws(() => new Biome("x", 0, [], -1), RangeError);
    assert.equal(new Biome("x", 0).shadeStrength, 1);
    assert.throws(() => new Biome("x", 0).biomeId, /freeze/);
});

test("biomeAt is deterministic and honors first-match order", () => {
    const registry = standardLoadout();
    const [peak, dry, grass] = registry.biomes;
    const [height, humidity] = registry.noiseChannels.slice(1);
    const a = new Terrain(new WorldNoise(99, registry.noiseChannels), registry.biomes);
    const b = new Terrain(new WorldNoise(99, registry.noiseChannels), registry.biomes);
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
        const tileX = (i * 37) % 500;
        const tileY = (i * 91) % 500;
        const biomeId = a.biomeAt(tileX, tileY);
        assert.equal(biomeId, b.biomeAt(tileX, tileY));
        seen.add(biomeId);
        const h = a.noise.get(tileX, tileY, height.channelId);
        const m = a.noise.get(tileX, tileY, humidity.channelId);
        if (h >= 0.7) {
            assert.equal(biomeId, peak.biomeId);
        } else if (m <= 0.4) {
            assert.equal(biomeId, dry.biomeId);
        } else {
            assert.equal(biomeId, grass.biomeId);
        }
    }
    assert.ok(seen.size >= 2);
});

test("bakeChunk lays tiles out row-major and caches the array", () => {
    const registry = standardLoadout();
    const terrain = new Terrain(new WorldNoise(3, registry.noiseChannels), registry.biomes);
    const chunk = chunkId(CHUNK_SIZE * 2, CHUNK_SIZE * -3);
    const bake = terrain.bakeChunk(chunk);
    assert.equal(bake.biomes.length, CHUNK_SIZE * CHUNK_SIZE);
    assert.equal(bake.biomes[5 * CHUNK_SIZE + 7], terrain.biomeAt(CHUNK_SIZE * 2 + 7, CHUNK_SIZE * -3 + 5));
    assert.equal(terrain.bakeChunk(chunk), bake);
    assert.ok(bake.levels.some(level => level > 0), "some tiles blend");
    for (let index = 0; index < bake.biomes.length; index++) {
        assert.ok(bake.levels[index] <= BLEND_LEVELS);
        if (bake.levels[index] === 0) {
            continue;
        }
        assert.notEqual(bake.others[index], bake.biomes[index]);
    }
});

test("the engine's shade channel is registered first and its name is reserved", () => {
    const registry = standardLoadout();
    assert.equal(registry.noiseChannels[0], SHADE_CHANNEL);
    assert.equal(SHADE_CHANNEL.channelId, 0);
    const terrain = new Terrain(new WorldNoise(4, registry.noiseChannels), registry.biomes);
    const shade = terrain.shadeAt(12, 34);
    assert.ok(shade >= 0 && shade <= 1);
    assert.throws(
        () => freezeLoadout([new NoiseChannel("shade", 0.1)], []),
        /Duplicate noise channel "shade"/,
    );
});

test("classify blends toward the biome across the nearest threshold", () => {
    const registry = standardLoadout();
    const [peak, dry, grass] = registry.biomes;
    const [height, humidity] = registry.noiseChannels.slice(1);
    const terrain = new Terrain(new WorldNoise(21, registry.noiseChannels), registry.biomes);
    let checked = 0;
    for (let i = 0; i < 40000 && checked < 30; i++) {
        const tileX = (i * 17) % 900;
        const tileY = (i * 31) % 900;
        const h = terrain.noise.get(tileX, tileY, height.channelId);
        const m = terrain.noise.get(tileX, tileY, humidity.channelId);
        if (h > 0.7 - BLEND_WIDTH) {
            continue;
        }
        const tile = terrain.classify(tileX, tileY);
        const gap = Math.abs(m - 0.4);
        if (gap < BLEND_WIDTH / 4) {
            // Right at the savanna/grass line: whichever side it fell, it blends toward the other.
            assert.ok(tile.level > 0);
            assert.deepEqual([tile.biomeId, tile.otherId].sort(), [dry.biomeId, grass.biomeId]);
            checked++;
        } else if (gap > BLEND_WIDTH) {
            assert.equal(tile.level, 0);
            assert.notEqual(tile.biomeId, peak.biomeId);
        }
    }
    assert.ok(checked >= 30);
});

test("a loadout without biomes refuses to classify", () => {
    const registry = freezeLoadout([], []);
    const terrain = new Terrain(new WorldNoise(1, registry.noiseChannels), registry.biomes);
    assert.throws(() => terrain.biomeAt(0, 0), /declares no biomes/);
});

test("bakeOverworldRows fills the region at cell resolution, row by row", () => {
    const registry = standardLoadout();
    const terrain = new Terrain(new WorldNoise(11, registry.noiseChannels), registry.biomes);
    assert.equal(terrain.overworldBake.biomes.length, OVERWORLD_CELLS_PER_AXIS * OVERWORLD_CELLS_PER_AXIS);
    assert.equal(terrain.overworldBake.levels, null);
    assert.equal(terrain.overworldBaked, false);

    assert.equal(terrain.bakeOverworldRows(100), 0);
    assert.equal(terrain.bakeOverworldRows(100), 100);
    let rows = 200;
    while (!terrain.overworldBaked) {
        terrain.bakeOverworldRows(300);
        rows += 300;
    }
    assert.ok(rows >= OVERWORLD_CELLS_PER_AXIS);
    assert.equal(terrain.bakeOverworldRows(10), OVERWORLD_CELLS_PER_AXIS);

    // Cell (column, row) samples the center tile of its OVERWORLD_CELL_TILES square.
    const originTile = -(REGION_SIZE * CHUNK_SIZE) / 2;
    for (const [column, row] of [[0, 0], [Math.floor(OVERWORLD_CELLS_PER_AXIS / 2) + 5, 33], [OVERWORLD_CELLS_PER_AXIS - 1, OVERWORLD_CELLS_PER_AXIS - 1]]) {
        const tileX = originTile + column * OVERWORLD_CELL_TILES + OVERWORLD_CELL_TILES / 2;
        const tileY = originTile + row * OVERWORLD_CELL_TILES + OVERWORLD_CELL_TILES / 2;
        assert.equal(terrain.overworldBake.biomes[row * OVERWORLD_CELLS_PER_AXIS + column], terrain.biomeAt(tileX, tileY));
    }
});

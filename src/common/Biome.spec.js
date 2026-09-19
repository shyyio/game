import {test} from "node:test";
import assert from "node:assert/strict";
import {Biome, NoiseRange, TerrainDetail} from "@/common/Biome.js";
import {NoiseChannel} from "@/common/NoiseChannel.js";

test("a biome draws its ground from the terrain sheet frame it names", () => {
    const biome = new Biome({name: "grassland", color: 0x7FA16A, texture: "dirt.png"});
    assert.equal(biome.texture, "dirt.png");
});

test("a biome without ground art names no frame", () => {
    assert.equal(new Biome({name: "grassland", color: 0x7FA16A}).texture, null);
});

test("a biome's edge draws from the transition frame it names", () => {
    const biome = new Biome({name: "grass", color: 0x4C7E6F, texture: "grass2.png", transition: "grass1.png"});
    assert.equal(biome.transition, "grass1.png");
});

test("a biome without transition art names no frame", () => {
    assert.equal(new Biome({name: "dirt", color: 0x855D3C, texture: "dirt.png"}).transition, null);
});

test("a biome keeps the color, ranges and details it declares", () => {
    const humidity = new NoiseChannel("humidity", 0.002, 2);
    const range = new NoiseRange(humidity, 0, 0.4);
    const rock = new TerrainDetail("terrain/rock-1", 0.01);
    const biome = new Biome({
        name: "savanna",
        color: 0x9FAA7A,
        ranges: [range],
        details: [rock],
    });
    assert.equal(biome.name, "savanna");
    assert.equal(biome.color, 0x9FAA7A);
    assert.deepEqual(biome.ranges, [range]);
    assert.deepEqual(biome.details, [rock]);
});

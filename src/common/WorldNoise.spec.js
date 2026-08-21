import {test} from "node:test";
import assert from "node:assert/strict";
import {WorldNoise, tileHash} from "@/common/WorldNoise.js";
import {NoiseChannel} from "@/common/NoiseChannel.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";

class ChannelsDeclaration extends AbstractModDeclaration {

    /**
     * @param {string} name
     * @param {NoiseChannel[]} channels
     */
    constructor(name, channels) {
        super();
        this._name = name;
        this._channels = channels;
    }

    get name() {
        return this._name;
    }

    get noiseChannels() {
        return this._channels;
    }
}

/**
 * @returns {NoiseChannel[]} frozen: the engine shade channel, then these at channelIds 1..3
 */
function makeChannels() {
    const channels = [
        new NoiseChannel("height", 0.01, 5),
        new NoiseChannel("temperature", 0.002),
        new NoiseChannel("humidity", 0.003, 2),
    ];
    const registry = new ModRegistry();
    registry.register(new ModPackage(new ChannelsDeclaration("A", channels.slice(0, 2))));
    registry.register(new ModPackage(new ChannelsDeclaration("B", channels.slice(2))));
    registry.freeze();
    return registry.noiseChannels;
}

test("freeze assigns channelIds in registration order and rejects duplicate names", () => {
    const channels = makeChannels();
    assert.deepEqual(channels.map(channel => channel.channelId), [0, 1, 2, 3]);
    assert.deepEqual(channels.map(channel => channel.name), ["shade", "height", "temperature", "humidity"]);

    const registry = new ModRegistry();
    registry.register(new ModPackage(new ChannelsDeclaration("A", [new NoiseChannel("height", 0.01)])));
    registry.register(new ModPackage(new ChannelsDeclaration("B", [new NoiseChannel("height", 0.02)])));
    assert.throws(() => registry.freeze(), /Duplicate noise channel "height"/);
});

test("channelId throws before freeze", () => {
    assert.throws(() => new NoiseChannel("x", 0.1).channelId, /freeze/);
});

test("NoiseChannel validates frequency and octaves", () => {
    assert.throws(() => new NoiseChannel("x", 0), RangeError);
    assert.throws(() => new NoiseChannel("x", 0.1, 0), RangeError);
    assert.throws(() => new NoiseChannel("x", 0.1, 1.5), RangeError);
});

test("same seed yields identical fields across instances", () => {
    const channels = makeChannels();
    const a = new WorldNoise(42, channels);
    const b = new WorldNoise(42, channels);
    for (let i = 0; i < 50; i++) {
        assert.equal(a.get(i * 3, i * 7, 0), b.get(i * 3, i * 7, 0));
        assert.equal(a.get(i * 3, i * 7, 2), b.get(i * 3, i * 7, 2));
    }
});

test("values stay within [0, 1] with octaves", () => {
    const noise = new WorldNoise(7, makeChannels());
    for (let i = 0; i < 500; i++) {
        const value = noise.get(i * 5, i * 11, i % 3);
        assert.ok(value >= 0 && value <= 1, `${value}`);
    }
});

test("different seeds and channels give different fields", () => {
    const channels = makeChannels();
    const a = new WorldNoise(1, channels);
    const b = new WorldNoise(2, channels);
    let seedDiff = 0;
    let channelDiff = 0;
    for (let i = 1; i < 50; i++) {
        if (a.get(i * 3, i * 7, 1) !== b.get(i * 3, i * 7, 1)) {
            seedDiff++;
        }
        if (a.get(i * 3, i * 7, 1) !== a.get(i * 3, i * 7, 2)) {
            channelDiff++;
        }
    }
    assert.ok(seedDiff > 40);
    assert.ok(channelDiff > 40);
});

test("a channel's field is seeded by name, not by its position in the loadout", () => {
    const first = new ModRegistry();
    const heightFirst = new NoiseChannel("height", 0.01, 3);
    first.register(new ModPackage(new ChannelsDeclaration("A", [heightFirst])));
    first.freeze();
    const second = new ModRegistry();
    const heightSecond = new NoiseChannel("height", 0.01, 3);
    second.register(new ModPackage(new ChannelsDeclaration("A", [new NoiseChannel("moisture", 0.05)])));
    second.register(new ModPackage(new ChannelsDeclaration("B", [heightSecond])));
    second.freeze();
    assert.equal(heightFirst.channelId, 1);
    assert.equal(heightSecond.channelId, 2);

    const a = new WorldNoise(5, first.noiseChannels);
    const b = new WorldNoise(5, second.noiseChannels);
    for (let i = 0; i < 50; i++) {
        assert.equal(a.get(i * 3, i * 7, heightFirst.channelId), b.get(i * 3, i * 7, heightSecond.channelId));
    }
});

test("rejects bad seeds and unknown channels", () => {
    const channels = makeChannels();
    assert.throws(() => new WorldNoise(-1, channels), RangeError);
    const noise = new WorldNoise(0, channels);
    assert.throws(() => noise.get(0, 0, 4), /No noise channel 4/);
    assert.throws(() => noise.get(0, 0, -1), /No noise channel -1/);
});

test("tileHash is deterministic and spreads across seeds and tiles", () => {
    assert.equal(tileHash(5, 10, -3), tileHash(5, 10, -3));
    const seen = new Set();
    for (let i = 0; i < 1000; i++) {
        seen.add(tileHash(1, i % 40, Math.floor(i / 40)) & 7);
    }
    assert.equal(seen.size, 8);
    assert.notEqual(tileHash(1, 0, 0), tileHash(2, 0, 0));
    assert.notEqual(tileHash(1, 0, 0), tileHash(1, 1, 0));
    assert.notEqual(tileHash(1, 0, 0), tileHash(1, 0, 1));
});

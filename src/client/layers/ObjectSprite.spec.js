import {test} from "node:test";
import assert from "node:assert/strict";
import {Texture} from "pixi.js";
import {ObjectSprite} from "@/client/layers/ObjectSprite.js";
import {ExtractorType} from "@/mods/base-game/common/objectTypes.js";
import {Direction} from "@/common/constants.js";

const FRAME_COUNT = 4;

/**
 * An animated-body sprite over `FRAME_COUNT` distinct frames.
 * @param {boolean} isStalled
 * @returns {{sprite: ObjectSprite, frames: Texture[]}}
 */
function buildSprite(isStalled) {
    const frames = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
        frames.push(new Texture({source: Texture.EMPTY.source}));
    }
    const sprite = new ObjectSprite({
        id: 1,
        tileX: 0,
        tileY: 0,
        direction: Direction.UP,
        texture: Texture.EMPTY,
        type: ExtractorType,
        bodyFrames: frames,
        isStalled,
    });
    return {sprite, frames};
}

test("a running body plays from its first frame whatever the clock stands at", () => {
    const {sprite, frames} = buildSprite(false);
    sprite.tick(5);
    assert.equal(sprite.body.texture, frames[0]);
    sprite.tick(6);
    assert.equal(sprite.body.texture, frames[1]);
    sprite.tick(7);
    assert.equal(sprite.body.texture, frames[2]);
});

test("a stalling body parks on its first frame", () => {
    const {sprite, frames} = buildSprite(false);
    sprite.tick(5);
    sprite.tick(6);
    sprite.isStalled = true;
    sprite.tick(7);
    assert.equal(sprite.body.texture, frames[0]);
    sprite.tick(8);
    assert.equal(sprite.body.texture, frames[0]);
});

test("a resuming body replays from its first frame", () => {
    const {sprite, frames} = buildSprite(false);
    sprite.tick(5);
    sprite.tick(6);
    sprite.isStalled = true;
    sprite.tick(7);
    sprite.isStalled = false;
    sprite.tick(9);
    assert.equal(sprite.body.texture, frames[0]);
    sprite.tick(10);
    assert.equal(sprite.body.texture, frames[1]);
});

test("a body still running across the clock's wrap keeps its phase", () => {
    const {sprite, frames} = buildSprite(false);
    sprite.tick(14);
    assert.equal(sprite.body.texture, frames[0]);
    sprite.tick(15);
    assert.equal(sprite.body.texture, frames[1]);
    sprite.tick(0);
    assert.equal(sprite.body.texture, frames[2]);
    sprite.tick(1);
    assert.equal(sprite.body.texture, frames[3]);
});

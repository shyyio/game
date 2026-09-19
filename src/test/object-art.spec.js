import {test} from "node:test";
import assert from "node:assert/strict";
import animatedSheet from "@/mods/base-textures/animated.json";
import mainSheet from "@/mods/base-textures/main.json";
import terrainSheet from "@/mods/base-textures/terrain.json";
import {BaseGameDeclaration} from "@/mods/base-game/declaration.js";
import {ANIMATION_CYCLE_FRAMES} from "@/client/layers/animation.js";

const BASE_TEXTURE_FRAMES = new Set();
for (const sheet of [animatedSheet, mainSheet, terrainSheet]) {
    for (const frameName of Object.keys(sheet.frames)) {
        BASE_TEXTURE_FRAMES.add(frameName);
    }
}

test("every base-game object type draws from a frame the shared atlases ship", () => {
    for (const type of new BaseGameDeclaration().objectTypes) {
        if (type.textureName !== null) {
            assert.ok(BASE_TEXTURE_FRAMES.has(type.textureName), `"${type.name}" draws from missing frame "${type.textureName}"`);
        }
        if (type.bodyTextureName !== null) {
            assert.ok(BASE_TEXTURE_FRAMES.has(type.bodyTextureName), `"${type.name}" draws its body from missing frame "${type.bodyTextureName}"`);
        }
    }
});

test("every animated body ships a sequence the shared clock divides evenly", () => {
    for (const type of new BaseGameDeclaration().objectTypes) {
        if (type.bodyAnimationName === null) {
            continue;
        }
        let frameCount = 0;
        while (BASE_TEXTURE_FRAMES.has(`${type.bodyAnimationName}/${frameCount}`)) {
            frameCount += 1;
        }
        assert.ok(frameCount > 0, `"${type.name}" animates its body from missing sequence "${type.bodyAnimationName}"`);
        assert.equal(ANIMATION_CYCLE_FRAMES % frameCount, 0, `"${type.bodyAnimationName}" has ${frameCount} frames, which the clock's cycle does not divide`);
    }
});

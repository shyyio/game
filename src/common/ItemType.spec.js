import {test} from "node:test";
import assert from "node:assert/strict";
import {ItemType, ItemAgeFrameEntry} from "@/common/ItemType.js";

test("an item type with no age frames shows one texture whatever its age", () => {
    const type = new ItemType("Coal", "items/coal");

    assert.equal(type.getTextureByAge(0), "items/coal");
    assert.equal(type.getTextureByAge(400), "items/coal");
});

test("an aging item type shows the frame its age has reached", () => {
    const type = new ItemType("Raw Steel", "items/steel3", 0xFFFFFF, [
        new ItemAgeFrameEntry("items/steel0", 0),
        new ItemAgeFrameEntry("items/steel1", 1),
        new ItemAgeFrameEntry("items/steel2", 3),
        new ItemAgeFrameEntry("items/steel3", 5),
    ]);

    assert.equal(type.getTextureByAge(0), "items/steel0");
    assert.equal(type.getTextureByAge(1), "items/steel1");
    assert.equal(type.getTextureByAge(2), "items/steel1");
    assert.equal(type.getTextureByAge(3), "items/steel2");
    assert.equal(type.getTextureByAge(5), "items/steel3");
    assert.equal(type.getTextureByAge(900), "items/steel3");
});

// An item from a save written before items carried a birth tick reads as born on tick 0, so it is
// simply very old: the last frame, which is what the type shows at rest.
test("an aging item type shows its last frame for an item older than every frame", () => {
    const type = new ItemType("Raw Steel", "items/steel3", 0xFFFFFF, [
        new ItemAgeFrameEntry("items/steel0", 0),
        new ItemAgeFrameEntry("items/steel3", 5),
    ]);

    assert.equal(type.getTextureByAge(4000), type.texture);
});

test("an aging item type reports when an age has reached its last frame", () => {
    const type = new ItemType("Raw Steel", "items/steel3", 0xFFFFFF, [
        new ItemAgeFrameEntry("items/steel0", 0),
        new ItemAgeFrameEntry("items/steel3", 5),
    ]);

    assert.equal(type.isFullyAged(4), false);
    assert.equal(type.isFullyAged(5), true);
    assert.equal(type.isFullyAged(900), true);
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {PlacementRule} from "@/common/ObjectType.js";
import {BeltType, BeltUndergroundType, BeltRampUp1Type, RoadType} from "@/mods/logistics/common/objectTypes.js";
import {PipeType} from "@/mods/fluids/common/objectTypes.js";

test("a placement rule is copyable unless it opts out", () => {
    assert.equal(new PlacementRule().isCopyable, true);
    assert.equal(new PlacementRule({isCopyable: false}).isCopyable, false);
});

test("a buried belt span is not copyable; its mouths are", () => {
    assert.equal(BeltUndergroundType.placement.isCopyable, false);
    assert.equal(BeltType.placement.isCopyable, true);
});

test("a type names its ghost texture; a belt kind names its UP-facing frame", () => {
    assert.equal(RoadType.ghostTextureName, RoadType.textureName);
    assert.equal(BeltType.ghostTextureName, "belt-up/0");
    assert.equal(BeltRampUp1Type.ghostTextureName, "belt-ramp-up/0");
});

test("a pipe placed over a pipe overwrites it", () => {
    assert.equal(PipeType.placement.shouldReplaceSameKind, true);
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {BeltType, HousingType} from "@/mods/logistics/common/objectTypes.js";
import {ecsModRegistry} from "@/test/ecsSim.js";

const modRegistry = ecsModRegistry();

test("a quarter turn turns each entry's offset and facing around the anchor", () => {
    const blueprint = new Blueprint([
        new BlueprintEntry(BeltType.objectTypeId, 2, 0, Direction.UP),
        new BlueprintEntry(BeltType.objectTypeId, 0, 3, Direction.RIGHT),
    ]);

    const turned = blueprint.rotate(1, modRegistry);

    assert.deepEqual(turned.entries.map(entry => [entry.tileX, entry.tileY, entry.direction]), [
        [0, 2, Direction.RIGHT],
        [-3, 0, Direction.DOWN],
    ]);
});

test("four quarter turns leave a blueprint as it was", () => {
    const blueprint = new Blueprint([
        new BlueprintEntry(BeltType.objectTypeId, 2, 1, Direction.LEFT),
        new BlueprintEntry(HousingType.objectTypeId, 4, 4, Direction.UP),
    ]);

    const turned = blueprint.rotate(1, modRegistry).rotate(1, modRegistry).rotate(1, modRegistry).rotate(1, modRegistry);

    assert.deepEqual(turned.entries, blueprint.entries);
});

test("a non-directional 2x2 keeps its cells and faces UP after a turn", () => {
    const blueprint = new Blueprint([new BlueprintEntry(HousingType.objectTypeId, 0, 0, Direction.UP)]);

    const entry = blueprint.rotate(1, modRegistry).entries[0];

    assert.deepEqual([entry.tileX, entry.tileY, entry.direction], [-1, 0, Direction.UP]);
});

test("the bounds cover every entry's footprint", () => {
    const blueprint = new Blueprint([
        new BlueprintEntry(BeltType.objectTypeId, 2, 0, Direction.UP),
        new BlueprintEntry(HousingType.objectTypeId, -1, 3, Direction.UP),
    ]);

    assert.deepEqual(blueprint.getBounds(modRegistry), {minTileX: -1, minTileY: 0, maxTileX: 2, maxTileY: 4});
});

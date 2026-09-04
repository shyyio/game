import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {StaticBehavior} from "@/common/behaviors/StaticBehavior.js";
import {ObjectType, PlacementRule} from "@/common/ObjectType.js";
import {conversionLosses, convertSnapshot} from "@/sim/snapshotConversion.js";

const GadgetType = new ObjectType({
    name: "ConversionGadget",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "Gadget",
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new StaticBehavior(),
});

class GadgetDeclaration extends AbstractModDeclaration {

    get name() {
        return "ConversionFixture";
    }

    get objectTypes() {
        return [GadgetType];
    }
}

test("a world converts to a loadout without one of its mods: its objects go, the rest carries over", async () => {
    const before = await makeGameEngine([new ModPackage(new GadgetDeclaration())]);
    before.applyMessage(new CreateObjectMessage(GadgetType.typeId, 5, 5, Direction.UP));
    before.applyMessage(new CreateObjectMessage(GadgetType.typeId, 7, 5, Direction.UP));
    assert.equal(before.placed.eidsOf(GadgetType.typeId).length, 2);

    const after = await makeGameEngine();
    const next = after.snapshots.loadout;
    assert.deepEqual([...conversionLosses(before.snapshots.serialize(), next).objects], [["ConversionGadget", 2]]);

    before.removeObjectsOfType(GadgetType.typeId);
    assert.equal(before.placed.eidsOf(GadgetType.typeId).length, 0);
    const converted = convertSnapshot(before.snapshots.serialize(), next, after.components.defs);
    after.snapshots.deserialize(converted);
    assert.deepEqual(after.snapshots.serialize().objectTypeNames, next.typeNames);
});

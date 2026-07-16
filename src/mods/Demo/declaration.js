// Reference mod: a 1x1 furnace that "cooks" one input item into an output (or Junk when the item has
// no recipe), sharing its ports with adjacent belts. The sim is fully derived from the declaration.
import {
    AbstractModDeclaration,
    ObjectType,
    PortDefinition,
    RecipeDefinition,
    PlacementRule,
    MachineBehavior,
    Direction,
} from "@/sdk/common.js";

// The item the furnace cooks and the outputs (a real product + the fallback).
export const DEMO_INPUT_ITEM_TYPE = 7;
export const DEMO_OUTPUT_ITEM_TYPE = 101;
export const DEMO_JUNK_ITEM_TYPE = 102;

export const DemoMachineType = new ObjectType({
    name: "DemoMachine",
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Machine",
    inspectable: true,
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new MachineBehavior({
        processingTicks: 2,
        recipes: [new RecipeDefinition([DEMO_INPUT_ITEM_TYPE], DEMO_OUTPUT_ITEM_TYPE)],
        fallback: DEMO_JUNK_ITEM_TYPE,
    }),
});

export class DemoDeclaration extends AbstractModDeclaration {

    get objectTypes() {
        return [DemoMachineType];
    }

    get itemTextures() {
        return {
            [DEMO_INPUT_ITEM_TYPE]: "items/2",
            [DEMO_OUTPUT_ITEM_TYPE]: "items/1",
            [DEMO_JUNK_ITEM_TYPE]: "items/1",
        };
    }
}

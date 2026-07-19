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
export const ITEM_TYPE_DEMO_INPUT = 7;
export const ITEM_TYPE_DEMO_OUTPUT = 101;
export const ITEM_TYPE_DEMO_JUNK = 102;

// Labor the furnace consumes when road-connected to housing.
export const DEMO_MACHINE_LABOR_COST = 2;

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
        recipes: [new RecipeDefinition([ITEM_TYPE_DEMO_INPUT], ITEM_TYPE_DEMO_OUTPUT)],
        fallback: ITEM_TYPE_DEMO_JUNK,
        laborCost: DEMO_MACHINE_LABOR_COST,
    }),
});

export class DemoDeclaration extends AbstractModDeclaration {

    get objectTypes() {
        return [DemoMachineType];
    }

    get itemTextures() {
        return {
            [ITEM_TYPE_DEMO_INPUT]: "items/2",
            [ITEM_TYPE_DEMO_OUTPUT]: "items/1",
            [ITEM_TYPE_DEMO_JUNK]: "items/1",
        };
    }
}

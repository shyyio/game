import {
    AbstractModDeclaration,
    ObjectType,
    PortDefinition,
    RecipeDefinition,
    PlacementRule,
    MachineBehavior,
    Direction,
} from "@/sdk/common.js";

/**
 * A test-only fixture (not part of BaseGame's real content): a plain 1x1, 1-input/1-output, manned
 * machine. Generic engine tests (placement, rotation, worker networks) want a simple stand-in shape
 * that never changes — pointing them at a real BaseGame machine type couples them to that machine's
 * content decisions (recipe, size, worker cost), which churns independently. See
 * src/test/volcanoFixture.js for the same pattern applied to resources/extractors.
 */

export const ITEM_TYPE_TEST_MACHINE_INPUT = 940;
export const ITEM_TYPE_TEST_MACHINE_OUTPUT = 941;
export const TEST_MACHINE_WORKER_COST = 2;

export const TestMachineType = new ObjectType({
    name: "TestMachine",
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Test Machine",
    inspectable: true,
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new MachineBehavior({
        processingTicks: 2,
        recipes: [new RecipeDefinition([ITEM_TYPE_TEST_MACHINE_INPUT], ITEM_TYPE_TEST_MACHINE_OUTPUT)],
        fallback: 0,
        workerCost: TEST_MACHINE_WORKER_COST,
    }),
});

export class MachineFixtureDeclaration extends AbstractModDeclaration {

    get name() {
        return "MachineFixture";
    }

    get objectTypes() {
        return [TestMachineType];
    }
}

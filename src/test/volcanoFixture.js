import {
    AbstractModDeclaration,
    ObjectType,
    PortDefinition,
    RecipeDefinition,
    PlacementRule,
    ResourceBehavior,
    ExtractorBehavior,
    Direction,
    ItemDefinition,
    ItemCategory,
} from "@/sdk/common.js";

/**
 * A test-only fixture (not part of BaseGame's real content): a 2x2 solid resource body with a ring
 * of extraction tiles, fed by two independently configured extractors — one producing a solid item,
 * one a fluid. Exercises engine capabilities BaseGame's own content never needs (a multi-tile solid
 * resource body, two distinct extractor speeds/recipes sharing one body, a second fluid item type),
 * so volcano-extractor.spec.js and pipe-fluid-flow.spec.js use this instead of real mod content.
 */

export const RESOURCE_TEST_VOLCANO = 900;
export const ITEM_TYPE_TEST_SULFUR = 901;
export const ITEM_TYPE_TEST_BRINE = 902;

const TEST_VOLCANO_EXTRACTION_TILES = [
    {x: 0, y: -1}, {x: 1, y: -1},
    {x: 0, y: 2}, {x: 1, y: 2},
    {x: -1, y: 0}, {x: -1, y: 1},
    {x: 2, y: 0}, {x: 2, y: 1},
];

// Non-directional: extraction cover is laid unrotated, so the body must never rotate either.
export const TestVolcanoResourceType = new ObjectType({
    name: "TestVolcanoResource",
    geometry: "2x2",
    textureName: "resource/placeholder-2x2",
    directional: false,
    label: "Test Volcano",
    extractionTiles: TEST_VOLCANO_EXTRACTION_TILES,
    behavior: new ResourceBehavior({resourceType: RESOURCE_TEST_VOLCANO}),
});

export const TestExtractorType = new ObjectType({
    name: "TestExtractor",
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Test Extractor",
    inspectable: true,
    placement: new PlacementRule({replaceSameKind: true, placeOn: [TestVolcanoResourceType]}),
    behavior: new ExtractorBehavior({
        processingTicks: 4,
        recipes: [new RecipeDefinition([RESOURCE_TEST_VOLCANO], ITEM_TYPE_TEST_SULFUR)],
    }),
});

export const TestDeepExtractorType = new ObjectType({
    name: "TestDeepExtractor",
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Test Deep Extractor",
    inspectable: true,
    placement: new PlacementRule({replaceSameKind: true, placeOn: [TestVolcanoResourceType]}),
    behavior: new ExtractorBehavior({
        processingTicks: 8,
        recipes: [new RecipeDefinition([RESOURCE_TEST_VOLCANO], ITEM_TYPE_TEST_BRINE)],
    }),
});

export class VolcanoFixtureDeclaration extends AbstractModDeclaration {

    get name() {
        return "VolcanoFixture";
    }

    get objectTypes() {
        return [TestVolcanoResourceType, TestExtractorType, TestDeepExtractorType];
    }

    get items() {
        return [new ItemCategory("Volcano", {
            [ITEM_TYPE_TEST_SULFUR]: new ItemDefinition("Test Sulfur", "items/2"),
            [ITEM_TYPE_TEST_BRINE]: new ItemDefinition("Test Brine", "items/1"),
        })];
    }

    get fluidTypes() {
        return [ITEM_TYPE_TEST_BRINE];
    }
}

// Resources + extractors: placeable resource bodies (a lake, a volcano) that an extractor sits on to
// spawn items. The sim is fully derived from the declaration; extraction maps a resource type to an
// item per extractor.
import {
    AbstractModDeclaration,
    ObjectType,
    PortDefinition,
    RecipeDefinition,
    PlacementRule,
    ResourceBehavior,
    ExtractorBehavior,
    Direction,
} from "@/sdk/common.js";

// Resource types and the items extraction spawns.
export const RESOURCE_WATER = 200;
export const RESOURCE_VOLCANO = 201;
export const ITEM_TYPE_WATER = 210;
export const ITEM_TYPE_SULFUR = 211;
export const ITEM_TYPE_BRINE = 212;

// ---- Resource types ----

export const WaterResourceType = new ObjectType({
    name: "WaterResource",
    geometry: "1x1",
    textureName: "resource/placeholder",
    label: "Water",
    // An extractor sits directly on the water tile, so the body never blocks it.
    extractionTiles: [{x: 0, y: 0}],
    placement: new PlacementRule({solid: false}),
    behavior: new ResourceBehavior({resourceType: RESOURCE_WATER}),
});

// The volcano is solid: extractors sit on the ring of tiles orthogonally bordering its 2x2 body.
export const VOLCANO_EXTRACTION_TILES = [
    {x: 0, y: -1}, {x: 1, y: -1},
    {x: 0, y: 2}, {x: 1, y: 2},
    {x: -1, y: 0}, {x: -1, y: 1},
    {x: 2, y: 0}, {x: 2, y: 1},
];

export const VolcanoResourceType = new ObjectType({
    name: "VolcanoResource",
    geometry: "2x2",
    textureName: "resource/placeholder-2x2",
    label: "Volcano",
    extractionTiles: VOLCANO_EXTRACTION_TILES,
    behavior: new ResourceBehavior({resourceType: RESOURCE_VOLCANO}),
});

export const RESOURCE_TYPES = [WaterResourceType, VolcanoResourceType];

// ---- Extractor types ----

export const ExtractorType = new ObjectType({
    name: "Extractor",
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Extractor",
    inspectable: true,
    placement: new PlacementRule({replaceSameKind: true, placeOn: RESOURCE_TYPES}),
    behavior: new ExtractorBehavior({
        processingTicks: 4,
        recipes: [
            new RecipeDefinition([RESOURCE_WATER], ITEM_TYPE_WATER),
            new RecipeDefinition([RESOURCE_VOLCANO], ITEM_TYPE_SULFUR),
        ],
    }),
});

export const DeepExtractorType = new ObjectType({
    name: "DeepExtractor",
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Deep Extractor",
    inspectable: true,
    placement: new PlacementRule({replaceSameKind: true, placeOn: RESOURCE_TYPES}),
    behavior: new ExtractorBehavior({
        processingTicks: 8,
        recipes: [new RecipeDefinition([RESOURCE_VOLCANO], ITEM_TYPE_BRINE)],
    }),
});

export const EXTRACTOR_TYPES = [ExtractorType, DeepExtractorType];

export class ResourcesDeclaration extends AbstractModDeclaration {

    get objectTypes() {
        return [...RESOURCE_TYPES, ...EXTRACTOR_TYPES];
    }

    get itemTextures() {
        return {
            [ITEM_TYPE_WATER]: "items/1",
            [ITEM_TYPE_SULFUR]: "items/2",
            [ITEM_TYPE_BRINE]: "items/1",
        };
    }
}

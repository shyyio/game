// Resources + extractors: placeable resource bodies (a lake, a volcano) that an extractor sits on to
// spawn items. The sim runs on the bitECS EasyResourceModule/EasyExtractorModule; extraction maps a
// resource type to an item per extractor.
import {
    AbstractMod,
    ObjectDefinition,
    PortDefinition,
    Direction,
    DeleteObjectMessage,
    MiniMenuEntry,
} from "@/sdk/common.js";
import {EasyObjectTool, EasyObjectGhostLayer, EasyObjectDrawLayer, InspectHighlight} from "@/sdk/client.js";
import {EasyResourceModule} from "@/common/sim/EasyResourceModule.js";
import {EasyExtractorModule} from "@/common/sim/EasyExtractorModule.js";

// Resource types and the items extraction spawns.
export const RESOURCE_WATER = 200;
export const RESOURCE_VOLCANO = 201;
export const WATER_ITEM_TYPE = 210;
export const SULFUR_ITEM_TYPE = 211;
export const BRINE_ITEM_TYPE = 212;

// ---- Resource definitions ----

export const WaterResourceDefinition = new ObjectDefinition({
    name: "WaterResource",
    inputPorts: [],
    outputPorts: [],
    internalPorts: [],
    geometry: "1x1",
    textureName: "resource/placeholder",
    label: "Water",
    // An extractor sits directly on the water tile.
    extractionTiles: [{x: 0, y: 0}],
});

// The volcano is solid: extractors sit on the ring of tiles orthogonally bordering its 2x2 body.
export const VOLCANO_EXTRACTION_TILES = [
    {x: 0, y: -1}, {x: 1, y: -1},
    {x: 0, y: 2}, {x: 1, y: 2},
    {x: -1, y: 0}, {x: -1, y: 1},
    {x: 2, y: 0}, {x: 2, y: 1},
];

export const VolcanoResourceDefinition = new ObjectDefinition({
    name: "VolcanoResource",
    inputPorts: [],
    outputPorts: [],
    internalPorts: [],
    geometry: "2x2",
    textureName: "resource/placeholder-2x2",
    label: "Volcano",
    extractionTiles: VOLCANO_EXTRACTION_TILES,
});

// ---- Extractor definitions ----

export const ExtractorDefinition = new ObjectDefinition({
    name: "Extractor",
    inputPorts: [],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    internalPorts: [],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Extractor",
});

export const DeepExtractorDefinition = new ObjectDefinition({
    name: "DeepExtractor",
    inputPorts: [],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    internalPorts: [],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Deep Extractor",
});

const RESOURCE_DEFINITIONS = [WaterResourceDefinition, VolcanoResourceDefinition];
const EXTRACTOR_DEFINITIONS = [ExtractorDefinition, DeepExtractorDefinition];
const OBJECT_DEFINITIONS = [...RESOURCE_DEFINITIONS, ...EXTRACTOR_DEFINITIONS];

export class ResourcesMod extends AbstractMod {

    get definitions() {
        return {
            [WaterResourceDefinition.name]: WaterResourceDefinition,
            [VolcanoResourceDefinition.name]: VolcanoResourceDefinition,
            [ExtractorDefinition.name]: ExtractorDefinition,
            [DeepExtractorDefinition.name]: DeepExtractorDefinition,
        };
    }

    /**
     * Registers the resource + extractor ECS modules and their handlers.
     * @param {GameEngine} sim
     * @returns {void}
     */
    setup(sim) {
        sim.resources = new EasyResourceModule(sim, [
            {definition: WaterResourceDefinition, resourceType: RESOURCE_WATER, solid: false},
            {definition: VolcanoResourceDefinition, resourceType: RESOURCE_VOLCANO, solid: true},
        ]);
        sim.resources.install(sim);

        const bindResource = (s, message) => s.resources.coverAt(message.x, message.y);
        sim.extractor = new EasyExtractorModule(sim, {
            definition: ExtractorDefinition,
            processingTicks: 4,
            recipes: [
                {resource: RESOURCE_WATER, output: WATER_ITEM_TYPE},
                {resource: RESOURCE_VOLCANO, output: SULFUR_ITEM_TYPE},
            ],
            bindResource,
        });
        sim.extractor.install(sim);

        sim.deepExtractor = new EasyExtractorModule(sim, {
            definition: DeepExtractorDefinition,
            processingTicks: 8,
            recipes: [{resource: RESOURCE_VOLCANO, output: BRINE_ITEM_TYPE}],
            bindResource,
            name: "DeepExtractor",
        });
        sim.deepExtractor.install(sim);
    }
}

// ---- Client mod ----

export class ResourcesClientMod extends ResourcesMod {

    constructor() {
        super();
        this._drawLayers = OBJECT_DEFINITIONS.map(definition => new EasyObjectDrawLayer(definition));
        this._ghostLayers = OBJECT_DEFINITIONS.map(definition => new EasyObjectGhostLayer(definition));
    }

    get drawLayers() {
        return [...this._drawLayers, ...this._ghostLayers];
    }

    get itemTextures() {
        return {
            [WATER_ITEM_TYPE]: "items/1",
            [SULFUR_ITEM_TYPE]: "items/2",
            [BRINE_ITEM_TYPE]: "items/1",
        };
    }

    tools(client) {
        return OBJECT_DEFINITIONS.map((definition, index) => {
            const isResource = RESOURCE_DEFINITIONS.includes(definition);
            // Extractors must land on a resource's extraction tile; those tiles highlight blue.
            const placeOn = EXTRACTOR_DEFINITIONS.includes(definition) ? RESOURCE_DEFINITIONS : [];
            // Resources never overwrite (a tile with a resource is blocked, not replaced).
            return new EasyObjectTool(client, definition, this._ghostLayers[index], !isResource, true, placeOn);
        });
    }

    /**
     * Outlines the resource or extractor whose tile is inspected.
     * @returns {InspectHighlight[]}
     */
    onInspect(tileX, tileY, client) {
        const highlights = [];
        OBJECT_DEFINITIONS.forEach(definition => {
            const object = client.cache.objectAt(tileX, tileY, definition);
            if (object !== null) {
                highlights.push(new InspectHighlight(object.tileX, object.tileY, object.data.direction, object.data.definition));
            }
        });
        return highlights;
    }

    miniMenuEntries(tileX, tileY, session, client) {
        const entries = [];
        EXTRACTOR_DEFINITIONS.forEach(definition => {
            const extractor = client.cache.objectAt(tileX, tileY, definition);
            if (extractor !== null) {
                entries.push(new MiniMenuEntry("Inspect Extractor", 20, () => client.inspectObject(extractor.id)));
                entries.push(new MiniMenuEntry("Delete Extractor", 10, () => session.sendMessage(new DeleteObjectMessage(extractor.id))));
            }
        });
        RESOURCE_DEFINITIONS.forEach(definition => {
            const resource = client.cache.objectAt(tileX, tileY, definition);
            if (resource !== null) {
                entries.push(new MiniMenuEntry("Delete Resource", 10, () => session.sendMessage(new DeleteObjectMessage(resource.id))));
            }
        });
        return entries;
    }
}

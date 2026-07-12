// Resources + extractors: placeable resource bodies (a lake, a volcano) that an extractor sits on to
// spawn items. Extraction is the shared Recipes table keyed on verb + resource type. All Easy*: a
// resource is an EasyObjectPlacement wrapped by EasyResource; an extractor is ports + an EasyExtractor.
import {
    AbstractMod,
    EasyObjectPlacement,
    EasyResource,
    EasyExtractor,
    ObjectDefinition,
    PortDefinition,
    RecipeDefinition,
    SqlStatement,
    Direction,
    CreateObjectMessage,
    DeleteObjectMessage,
    MiniMenuEntry,
} from "@/sdk/common.js";
import {EasyObjectTool, EasyObjectGhostLayer, EasyObjectDrawLayer, InspectHighlight} from "@/sdk/client.js";
import {ResourceModule} from "@/common/sim/ResourceSystems.js";
import {ExtractorModule} from "@/common/sim/ExtractorSystems.js";

// Extraction verbs (Recipes keyspace; distinct from machine verbs).
const VERB_EXTRACT_PRIMARY = 10;
const VERB_EXTRACT_SECONDARY = 11;

// Resource types (recipe inputs) and the items extraction spawns.
export const RESOURCE_WATER = 200;
export const RESOURCE_VOLCANO = 201;
export const WATER_ITEM_TYPE = 210;
export const SULFUR_ITEM_TYPE = 211;
export const BRINE_ITEM_TYPE = 212;

// ---- Resource definitions ----

export const WaterResourceDefinition = new ObjectDefinition({
    table: "WaterResource",
    inputPorts: [],
    outputPorts: [],
    internalPorts: [],
    geometry: "1x1",
    textureName: "resource/placeholder",
    label: "Water",
});

export const VolcanoResourceDefinition = new ObjectDefinition({
    table: "VolcanoResource",
    inputPorts: [],
    outputPorts: [],
    internalPorts: [],
    geometry: "2x2",
    textureName: "resource/placeholder-2x2",
    label: "Volcano",
});

// The volcano is solid: extractors sit on the ring of tiles orthogonally bordering its 2x2 body.
export const VOLCANO_EXTRACTION_TILES = [
    {x: 0, y: -1}, {x: 1, y: -1},
    {x: 0, y: 2}, {x: 1, y: 2},
    {x: -1, y: 0}, {x: -1, y: 1},
    {x: 2, y: 0}, {x: 2, y: 1},
];

// ---- Extractor definitions ----

export const ExtractorDefinition = new ObjectDefinition({
    table: "Extractor",
    inputPorts: [],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    internalPorts: [],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Extractor",
});

export const DeepExtractorDefinition = new ObjectDefinition({
    table: "DeepExtractor",
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
const EXTRACTOR_TABLES = EXTRACTOR_DEFINITIONS.map(definition => definition.table);

export class ResourcesMod extends AbstractMod {

    constructor() {
        super();
        this._water = new EasyResource({
            definition: WaterResourceDefinition,
            resourceType: RESOURCE_WATER,
        });
        this._volcano = new EasyResource({
            definition: VolcanoResourceDefinition,
            resourceType: RESOURCE_VOLCANO,
            extractionTiles: VOLCANO_EXTRACTION_TILES,
            blocksSurface: true,
        });
        this._extractor = new EasyExtractor({verb: VERB_EXTRACT_PRIMARY, processingTicks: 4});
        this._deepExtractor = new EasyExtractor({verb: VERB_EXTRACT_SECONDARY, processingTicks: 8});
        this._extractor.install(ExtractorDefinition);
        this._deepExtractor.install(DeepExtractorDefinition);
        this._extractors = [this._extractor, this._deepExtractor];
        this._extractorPlacement = new EasyObjectPlacement(ExtractorDefinition);
        this._deepExtractorPlacement = new EasyObjectPlacement(DeepExtractorDefinition);
        // Every placeable this mod owns, for schema/statements/message/sync fan-out.
        this._placeables = [
            this._water,
            this._volcano,
            this._extractorPlacement,
            this._deepExtractorPlacement,
        ];
        this._resources = [this._water, this._volcano];
    }

    get schema() {
        return this._placeables.map(placeable => placeable.schema).join("\n");
    }

    get definitions() {
        return {
            [WaterResourceDefinition.table]: WaterResourceDefinition,
            [VolcanoResourceDefinition.table]: VolcanoResourceDefinition,
            [ExtractorDefinition.table]: ExtractorDefinition,
            [DeepExtractorDefinition.table]: DeepExtractorDefinition,
        };
    }

    get recipes() {
        return [
            new RecipeDefinition(VERB_EXTRACT_PRIMARY, [RESOURCE_WATER], WATER_ITEM_TYPE),
            new RecipeDefinition(VERB_EXTRACT_PRIMARY, [RESOURCE_VOLCANO], SULFUR_ITEM_TYPE),
            new RecipeDefinition(VERB_EXTRACT_SECONDARY, [RESOURCE_VOLCANO], BRINE_ITEM_TYPE),
        ];
    }

    get extraStatements() {
        const coverAt = this._resources.map(resource => resource.coverSubquery("@x", "@y")).join(", ");
        return [
            ...this._placeables.flatMap(placeable => placeable.statements),
            ...this._extractors.flatMap(extractor => extractor.statements),
            // The resource_type an extractor at (@x, @y) would draw from (first cover wins, else NULL).
            new SqlStatement("ResourceCoverAt", `SELECT COALESCE(${coverAt}) AS resource_type;`),
            // Re-derive every extractor's bound resource from what covers it now (a removed resource
            // unbinds its extractors, a re-added one rebinds them). Run on any resource change.
            ...EXTRACTOR_TABLES.map(table => new SqlStatement(
                `Rebind${table}`,
                `UPDATE ${table} SET resource_type = COALESCE(${
                    this._resources.map(resource => resource.coverSubquery(`${table}.x`, `${table}.y`)).join(", ")
                });`
            )),
        ];
    }

    chunkSyncEvents(chunk) {
        return this._placeables.flatMap(placeable => placeable.chunkSyncEvents(this.game, chunk));
    }

    onMessage(message) {
        this._placeables.forEach(placeable => placeable.handleMessage(this.game, message));
        if (this._changesResources(message)) {
            EXTRACTOR_TABLES.forEach(table => this.game.exec(`Rebind${table}`));
        }
    }

    /**
     * Registers the resource + extractor ECS modules and their handlers.
     * @param {EcsSimEngine} sim
     * @returns {void}
     */
    setupEcs(sim) {
        sim.resources = new ResourceModule(sim.engine);
        sim.extractor = new ExtractorModule(sim.engine, {
            processingTicks: 4,
            recipes: [
                {resource: RESOURCE_WATER, output: WATER_ITEM_TYPE},
                {resource: RESOURCE_VOLCANO, output: SULFUR_ITEM_TYPE},
            ],
        });
        sim.deepExtractor = new ExtractorModule(sim.engine, {
            processingTicks: 8,
            recipes: [{resource: RESOURCE_VOLCANO, output: BRINE_ITEM_TYPE}],
        });
        sim.registerMessageHandler(message => this._ecsResourceMessage(sim, message));
        sim.registerChunkSync(chunk => sim.resources.chunkSync(chunk));
        sim.registerChunkSync(chunk => sim.extractor.chunkSync(chunk));
        sim.registerChunkSync(chunk => sim.deepExtractor.chunkSync(chunk));
    }

    /**
     * @private
     * @param {EcsSimEngine} sim
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _ecsResourceMessage(sim, message) {
        if (message instanceof DeleteObjectMessage) {
            return sim.extractor.removeExtractorById(message.id)
                || sim.deepExtractor.removeExtractorById(message.id)
                || sim.resources.removeResourceById(message.id);
        }
        if (!(message instanceof CreateObjectMessage)) {
            return false;
        }
        if (message.typeId === WaterResourceDefinition.typeId) {
            sim.resources.placeResource(message.x, message.y, message.typeId, message.direction, RESOURCE_WATER, [{x: 0, y: 0}]);
            return true;
        }
        if (message.typeId === VolcanoResourceDefinition.typeId) {
            const footprint = sim.footprint(VolcanoResourceDefinition, message.x, message.y, message.direction);
            if (!sim.occupancyFree(footprint)) {
                return true;
            }
            const clientId = sim.resources.placeResource(message.x, message.y, message.typeId, message.direction, RESOURCE_VOLCANO, VOLCANO_EXTRACTION_TILES);
            sim.track(clientId, footprint);
            return true;
        }
        if (message.typeId === ExtractorDefinition.typeId) {
            this._ecsPlaceExtractor(sim, sim.extractor, ExtractorDefinition, message);
            return true;
        }
        if (message.typeId === DeepExtractorDefinition.typeId) {
            this._ecsPlaceExtractor(sim, sim.deepExtractor, DeepExtractorDefinition, message);
            return true;
        }
        return false;
    }

    /**
     * @private
     * @param {EcsSimEngine} sim
     * @param {ExtractorModule} module
     * @param {ObjectDefinition} definition
     * @param {CreateObjectMessage} message
     * @returns {void}
     */
    _ecsPlaceExtractor(sim, module, definition, message) {
        const resourceType = sim.resources.coverAt(message.x, message.y);
        if (resourceType === null) {
            return;
        }
        const footprint = sim.footprint(definition, message.x, message.y, message.direction);
        if (!sim.occupancyFree(footprint)) {
            return;
        }
        const output = sim.portFor(definition.outputPorts[0], message.x, message.y, message.direction);
        const clientId = module.placeExtractor(message.x, message.y, message.typeId, message.direction, resourceType, output.port, output.tile);
        sim.track(clientId, footprint);
    }

    /**
     * Whether a message may have placed or removed a resource (so extractor bindings need refreshing).
     * A delete carries only an id, so any delete conservatively triggers a rebind.
     * @private
     * @returns {boolean}
     */
    _changesResources(message) {
        if (message instanceof DeleteObjectMessage) {
            return true;
        }
        return message instanceof CreateObjectMessage
            && (message.typeId === WaterResourceDefinition.typeId || message.typeId === VolcanoResourceDefinition.typeId);
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

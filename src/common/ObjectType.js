import {LAYER_SURFACE} from "@/common/constants.js";
import {ObjectGeometries} from "@/common/ObjectGeometry.js";
import {StaticBehavior} from "@/common/behaviors/StaticBehavior.js";

export class PortDefinition {
    /**
     * @param {string} name
     * @param [vec] {Vec|null} the edge the port sits on, for an UP-facing object: `x`/`y` offset
     *     in tiles from the origin (top-left) tile, UP being -y, and `direction` the flow across it.
     *     The edge is "flow entering tile (x, y) going direction", so a back input is
     *     {0, 0, UP} and a front output {0, -1, UP}; `engine.portFor` rotates it by the placement.
     *     null for an internal port.
     * @param [render] {boolean} the engine draws this output port's resting item, and the object's
     *     insert/sync events carry its ref (getRenderedPortEids, in outputPorts order); off for a
     *     virtual port or one the behavior draws itself
     * @param [fluid] {boolean} an adjacent pipe network may deliver into this input port; the
     *     behavior claims it with `engine.ports.markFluid` on spawn (a pipe only ever delivers into a
     *     port `engine.ports.isFluidClaimed` answers true for)
     */
    constructor(name, vec=null, render=true, fluid=false) {
        this.name = name;
        this.render = render;
        this.fluid = fluid;
        if (vec !== null) {
            this.x = vec.x;
            this.y = vec.y;
            this.direction = vec.direction;
        } else {
            this.x = null;
            this.y = null;
            this.direction = null;
        }
    }
}

export class RecipeByproduct {

    /**
     * A recipe's chance-driven secondary output, landing in the object type's second output port.
     * @param {number} itemTypeId
     * @param {number} chance in [0, 1], rolled once per craft via a deterministic per-craft seed
     */
    constructor(itemTypeId, chance) {
        this.itemTypeId = itemTypeId;
        this.chance = chance;
    }
}

export class RecipeDefinition {

    /**
     * One recipe: a consumed input set mapping to an output item. A processor consumes one item type
     * per input port; an extractor consumes exactly one resource type (its sole input).
     * @param {number[]} inputs
     * @param {number} output
     * @param {RecipeByproduct} [byproduct] a chance-driven secondary output alongside the main one
     */
    constructor(inputs, output, byproduct=null) {
        this.inputs = inputs;
        this.output = output;
        this.byproduct = byproduct;
    }
}

export class PlacementRule {

    /**
     * How an object type may be placed.
     * @param {object} [config]
     * @param {boolean} [config.shouldReplaceSameKind] - placing over a same-kind conveyor lane overwrites it
     * @param {boolean} [config.shouldAdvanceOnPlace] - center-lock advances one tile after placing;
     *     off for one-off objects
     * @param {ObjectType[]} [config.placeOn] - restrict placement to these types' extraction tiles
     * @param {boolean} [config.isSolid] - whether the object occupies its footprint (blocks the tile)
     * @param {boolean} [config.shouldDragToPlace] - dragging lays one placement per tile entered
     * @param {boolean} [config.isConveyor] - the type is a straight surface lane an aligned
     *     placement may overwrite
     */
    constructor({
        shouldReplaceSameKind = false,
        shouldAdvanceOnPlace = true,
        placeOn = [],
        isSolid = true,
        shouldDragToPlace = false,
        isConveyor = false,
    } = {}) {
        this.shouldReplaceSameKind = shouldReplaceSameKind;
        this.shouldAdvanceOnPlace = shouldAdvanceOnPlace;
        this.placeOn = placeOn;
        this.isSolid = isSolid;
        this.shouldDragToPlace = shouldDragToPlace;
        this.isConveyor = isConveyor;
    }
}

// What a transport type carries, for adjacency rules.
export const CONVEYS_ITEM = 1;
export const CONVEYS_FLUID = 2;

export class ObjectType {

    /**
     * The entity blueprint for one placeable object: its geometry/ports (read by engine and client),
     * its sim behavior (a component+system bundle), and its placement/menu rules.
     * @param {object} config
     * @param config.name {string} the object type name (unique across the loadout)
     * @param [config.inputPorts] {PortDefinition[]}
     * @param [config.outputPorts] {PortDefinition[]}
     * @param [config.internalPorts] {PortDefinition[]}
     * @param config.geometry {string} a named geometry (key of ObjectGeometries, e.g. "1x1", "1x2")
     * @param [config.textureName] {string|null} the object sprite's texture, used by the derived layers
     * @param [config.bodyTextureName] {string|null} art drawn over textureName, for a machine standing on the shared frame
     * @param [config.bodyAnimationName] {string|null} the frame sequence a placed instance's body
     *     cycles through; bodyTextureName stays the still the placement ghost draws
     * @param [config.mapColor] {number|null} map-mode tile color; null uses the shared default
     * @param [config.overworldVisible] {boolean} whether the overworld bake includes this type's
     *     tiles; off for buried objects
     * @param [config.drawLayerIndex] {number} z-level of the type's derived draw layer (ground
     *     cover like roads sits lower so figures walk over it)
     * @param [config.directional] {boolean} whether placement facing matters; a non-directional
     *     type always spawns facing UP and its tool ignores rotation
     * @param [config.label] {string|null} the placement tool's label
     * @param [config.extractionTiles] {{x:number, y:number}[]|null} relative tiles an extractor draws
     *     this resource from (a resource's extraction set), used by the client placement tool
     * @param [config.behavior] {AbstractBehavior} the sim behavior; defaults to StaticBehavior
     *     (a bare spawn-managed entity)
     * @param [config.placement] {PlacementRule}
     * @param [config.inspectable] {boolean} wires the sim inspect path; also the client's default
     *     tap action when `tapAction` is left null
     * @param [config.tapAction] {function(entry: CacheEntry, session: AbstractSession, client: Client): void|null}
     *     the left-click (tool-less) action on a placed instance of this type; derived from
     *     `inspectable` when null
     * @param [config.bespokeClient] {boolean} the type's client mod brings its own layers/tools,
     *     so no derived client bundle is built
     * @param [config.toolId] {number|null} hand-authored stable identity for this type's derived
     *     placement tool (see AbstractTool#id); required unless bespokeClient, or the type never
     *     reaches Client._buildBundles (a sim-only test fixture)
     * @param [config.conveys] {number|null} what this transport carries (CONVEYS_ITEM/CONVEYS_FLUID);
     *     null for non-transport types
     * @param [config.wireAnchor] {{x: number, y: number}|null} where a logic wire attaches, in
     *     tiles from the origin tile's top-left corner; null = not wireable
     */
    constructor({
        name,
        inputPorts=[],
        outputPorts=[],
        internalPorts=[],
        geometry,
        textureName=null,
        bodyTextureName=null,
        bodyAnimationName=null,
        mapColor=null,
        overworldVisible=true,
        drawLayerIndex=20,
        directional=true,
        label=null,
        extractionTiles=null,
        behavior=undefined,
        placement=undefined,
        inspectable=false,
        tapAction=null,
        bespokeClient=false,
        toolId=null,
        conveys=null,
        wireAnchor=null,
    }) {
        if (ObjectGeometries[geometry] === undefined) {
            throw new Error(`Unknown object geometry "${geometry}"`);
        }
        this.name = name;
        this.inputPorts = inputPorts;
        this.outputPorts = outputPorts;
        this.internalPorts = internalPorts;
        // The named geometry; the `geometry` getter resolves it to the ObjectGeometry.
        this.geometryName = geometry;
        this.textureName = textureName;
        this.bodyTextureName = bodyTextureName;
        this.bodyAnimationName = bodyAnimationName;
        this.mapColor = mapColor;
        this.overworldVisible = overworldVisible;
        this.drawLayerIndex = drawLayerIndex;
        this.directional = directional;
        this.label = label;
        // The position layer this object sits on. Objects on different layers coexist on a tile.
        this.positionLayer = LAYER_SURFACE;
        this.extractionTiles = extractionTiles;
        if (behavior === undefined) {
            this.behavior = new StaticBehavior();
        } else {
            this.behavior = behavior;
        }
        this.behavior._attachType(this);
        if (placement === undefined) {
            this.placement = new PlacementRule();
        } else {
            this.placement = placement;
        }
        this.bespokeClient = bespokeClient;
        this.toolId = toolId;
        this.conveys = conveys;
        this.wireAnchor = wireAnchor;
        this.inspectable = inspectable;
        if (tapAction !== null) {
            this.tapAction = tapAction;
        } else if (inspectable) {
            this.tapAction = (entry, session, client) => client.inspectObject(entry.id);
        } else {
            this.tapAction = null;
        }
        // Stable numeric identity assigned at ModRegistry.freeze() (registration order); the wire
        // carries it and the client cache keys off this type.
        this._objectTypeId = null;
    }

    /**
     * @returns {number}
     */
    get objectTypeId() {
        if (this._objectTypeId === null) {
            throw new Error(`ObjectType "${this.name}" has no objectTypeId; freeze the ModRegistry first`);
        }
        return this._objectTypeId;
    }

    /**
     * Called by ModRegistry.freeze(). Loadouts share ObjectType instances, so the newest freeze owns
     * the number; a registry that outlives another loadout's freeze takes its own back through
     * ModRegistry.claimTypeIds().
     * @param {number} objectTypeId
     * @returns {void}
     */
    _assignObjectTypeId(objectTypeId) {
        this._objectTypeId = objectTypeId;
    }

    /**
     * Client hook: the texture for an entry's current data; state-dependent art overrides this.
     * @param {ObjectClientEntry} data
     * @returns {string}
     */
    getTextureByData(data) {
        return this.textureName;
    }

    /**
     * Client hook: a bespoke draw layer for this type; null selects the derived ObjectDrawLayer.
     * @param {Client} client
     * @returns {AbstractDrawLayer|null}
     */
    createDrawLayer(client) {
        return null;
    }

    /**
     * Client hook: a bespoke placement ghost; null selects the derived ObjectGhostLayer.
     * @param {Client} client
     * @returns {AbstractDrawLayer|null}
     */
    createGhostLayer(client) {
        return null;
    }

    /**
     * Client hook: a bespoke placement tool; null selects the derived ObjectTool.
     * @param {Client} client
     * @param {AbstractDrawLayer} ghostLayer
     * @returns {AbstractTool|null}
     */
    createTool(client, ghostLayer) {
        return null;
    }

    /**
     * The geometry (tiles/corner/isSpanningChunks) for this object's named size.
     * @returns {ObjectGeometry}
     */
    get geometry() {
        return ObjectGeometries[this.geometryName];
    }

    /**
     * The tiles this object occupies per layer facing `direction`: `{layer, cells}` entries. The
     * default is its geometry body on its own layer; a resource overrides this (body + extraction on
     * the resource layer, body on the surface block). Used by both positionLayer lookups (existing
     * objects) and the placement overlap check (the new object), so placement is symmetric.
     * @param {Direction} direction
     * @returns {{layer: string, cells: {x: number, y: number}[]}[]}
     */
    getPositionLayerTilesByDirection(direction) {
        const cells = this.geometry.getTilesByDirection(direction);
        return this.behavior.getPositionLayersByDirection(direction).map(layer => ({layer, cells}));
    }

    /**
     * The subset of this object's `portKind` ports the sim links. The default is all of them;
     * objects that bury a port (a belt mouth) override this.
     * @param {("inputPorts"|"outputPorts")} portKind
     * @returns {PortDefinition[]}
     */
    getActivePortsByKind(portKind) {
        return this[portKind];
    }

    /**
     * The subset of getActivePortsByKind a surface neighbor can connect to (for the client's connection
     * rendering / adjacency). The default is all active ports; objects that bury a port
     * override this.
     * @param {("inputPorts"|"outputPorts")} portKind
     * @returns {PortDefinition[]}
     */
    getSurfacePortsByKind(portKind) {
        return this.getActivePortsByKind(portKind);
    }
}

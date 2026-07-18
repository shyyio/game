import {LAYER_SURFACE} from "@/common/constants.js";
import {ObjectGeometries} from "@/common/ObjectGeometry.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import {StaticBehavior} from "@/common/sim/behaviors.js";
import {NotImplementedError} from "@/common/error.js";

export class PortDefinition {
    /**
     * @param name {string}
     * @param [vec] {Vec|null}
     * @param [render] {boolean} the engine captures this out-port's resting item into ViewedPortItem;
     *     opt out for virtual ports or out-ports captured manually
     */
    constructor(name, vec=null, render=true) {
        this.name = name;
        this.render = render;
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

export class RecipeDefinition {

    /**
     * One recipe: a consumed input set mapping to an output item. A processor consumes one item type
     * per input port; an extractor consumes exactly one resource type (its sole input).
     * @param {number[]} inputs
     * @param {number} output
     */
    constructor(inputs, output) {
        this.inputs = inputs;
        this.output = output;
    }
}

export class MiniMenuEntry {

    /**
     * @param {string} label
     * @param {number} rank
     * @param {function(): void} callback
     */
    constructor(label, rank, callback) {
        this.label = label;
        this.rank = rank;
        this.callback = callback;
    }
}

export class PlacementRule {

    /**
     * How an object type may be placed.
     * @param {object} [config]
     * @param {boolean} [config.replaceSameKind] - placing over a same-kind conveyor lane overwrites it
     * @param {boolean} [config.advanceOnPlace] - center-lock advances one tile after placing;
     *     off for one-off objects
     * @param {ObjectType[]} [config.placeOn] - restrict placement to these types' extraction tiles
     * @param {boolean} [config.solid] - whether the object occupies its footprint (blocks the tile)
     */
    constructor({
        replaceSameKind=false,
        advanceOnPlace=true,
        placeOn=[],
        solid=true,
    }={}) {
        this.replaceSameKind = replaceSameKind;
        this.advanceOnPlace = advanceOnPlace;
        this.placeOn = placeOn;
        this.solid = solid;
    }
}

export class MenuVerb {

    /**
     * One derived mini-menu action on an object type.
     * @param {number} rank
     */
    constructor(rank) {
        this.rank = rank;
    }

    /**
     * The mini-menu entry acting on the cached object `record`.
     * @param {ObjectType} type
     * @param {CacheEntry} record
     * @param {AbstractSession} session
     * @param {Client} client
     * @returns {MiniMenuEntry}
     */
    entry(type, record, session, client) {
        throw new NotImplementedError();
    }
}

export class InspectVerb extends MenuVerb {

    /**
     * @param {ObjectType} type
     * @param {CacheEntry} record
     * @param {AbstractSession} session
     * @param {Client} client
     * @returns {MiniMenuEntry}
     */
    entry(type, record, session, client) {
        return new MiniMenuEntry(
            `Inspect ${type.label}`,
            this.rank,
            () => client.inspectObject(record.id),
        );
    }
}

export class DeleteVerb extends MenuVerb {

    /**
     * @param {ObjectType} type
     * @param {CacheEntry} record
     * @param {AbstractSession} session
     * @param {Client} client
     * @returns {MiniMenuEntry}
     */
    entry(type, record, session, client) {
        return new MiniMenuEntry(
            `Delete ${type.label}`,
            this.rank,
            () => session.sendMessage(new DeleteObjectMessage(record.id)),
        );
    }
}

// Default verb ranks: inspect above delete.
const INSPECT_RANK = 20;
const DELETE_RANK = 10;

export class ObjectType {

    /**
     * The entity blueprint for one placeable object: its geometry/ports (read by engine and client),
     * its sim behavior (a component+system bundle), and its placement/menu rules.
     * @param config {object}
     * @param config.name {string} the object type name (unique across the loadout)
     * @param [config.inputPorts] {PortDefinition[]}
     * @param [config.outputPorts] {PortDefinition[]}
     * @param [config.internalPorts] {PortDefinition[]}
     * @param config.geometry {string} a named geometry (key of ObjectGeometries, e.g. "1x1", "1x2")
     * @param [config.renderConnections] {boolean} whether the shared ConnectionDrawLayer draws animated
     *     stubs at this object's connected ports (belts render their own bends instead)
     * @param [config.textureName] {string|null} the object sprite's texture, used by the derived layers
     * @param [config.label] {string|null} the placement tool's label
     * @param [config.extractionTiles] {{x:number, y:number}[]|null} relative tiles an extractor draws
     *     this resource from (a resource's extraction set), used by the client placement tool
     * @param [config.behavior] {AbstractBehavior|null} the sim behavior; defaults to StaticBehavior
     *     (a bare spawn-managed entity), null opts the type out of the derived sim entirely (belt)
     * @param [config.placement] {PlacementRule}
     * @param [config.inspectable] {boolean} wires the sim inspect path + client Inspect verb
     * @param [config.menuVerbs] {MenuVerb[]|null} derived from `inspectable` when null
     */
    constructor({
        name,
        inputPorts=[],
        outputPorts=[],
        internalPorts=[],
        geometry,
        renderConnections=false,
        textureName=null,
        label=null,
        extractionTiles=null,
        behavior=undefined,
        placement=undefined,
        inspectable=false,
        menuVerbs=null,
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
        this.renderConnections = renderConnections;
        this.textureName = textureName;
        this.label = label;
        // The position layer this object sits on. Objects on different layers coexist on a tile.
        this.positionLayer = LAYER_SURFACE;
        this.extractionTiles = extractionTiles;
        this.behavior = behavior === undefined ? new StaticBehavior() : behavior;
        if (this.behavior !== null) {
            this.behavior._attachType(this);
        }
        this.placement = placement === undefined ? new PlacementRule() : placement;
        this.inspectable = inspectable;
        this.menuVerbs = menuVerbs !== null ? menuVerbs : (
            inspectable
                ? [new InspectVerb(INSPECT_RANK), new DeleteVerb(DELETE_RANK)]
                : [new DeleteVerb(DELETE_RANK)]
        );
        // Stable numeric identity assigned at ModRegistry.freeze() (registration order); the wire
        // carries it and the client cache keys off this type.
        this._typeId = null;
    }

    /**
     * @returns {number}
     */
    get typeId() {
        if (this._typeId === null) {
            throw new Error(`ObjectType "${this.name}" has no typeId; freeze the ModRegistry first`);
        }
        return this._typeId;
    }

    /**
     * Called by ModRegistry.freeze(); reassignment to a different id throws (idempotent for the
     * repeated same-loadout freezes tests do).
     * @param {number} typeId
     * @returns {void}
     */
    _assignTypeId(typeId) {
        if (this._typeId !== null && this._typeId !== typeId) {
            throw new Error(`ObjectType "${this.name}" typeId reassigned: ${this._typeId} -> ${typeId}`);
        }
        this._typeId = typeId;
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
     * The geometry (tiles/corner/spansChunks) for this object's named size.
     * @returns {ObjectGeometry}
     */
    get geometry() {
        return ObjectGeometries[this.geometryName];
    }

    /**
     * The tiles this object occupies per layer facing `direction`: `{layer, cells}` records. The
     * default is its geometry body on its own layer; a resource overrides this (body + extraction on
     * the resource layer, body on the surface block). Used by both positionLayer lookups (existing
     * objects) and the placement overlap check (the new object), so placement is symmetric.
     * @param {Direction} direction
     * @returns {{layer: number, cells: {x: number, y: number}[]}[]}
     */
    positionLayerTiles(direction) {
        const cells = this.geometry.tiles(direction);
        return [{layer: this.positionLayer, cells}];
    }

    /**
     * The subset of this object's `portKind` ports exposed for a record in state `data`. The
     * default is all of them; objects that bury a port in some states (a belt ramp) override this.
     * @param {("inputPorts"|"outputPorts")} portKind
     * @param {object} data - the record's data (type, direction, ...)
     * @returns {PortDefinition[]}
     */
    activePorts(portKind, data) {
        return this[portKind];
    }

    /**
     * The subset of activePorts a surface neighbor can connect to (for the client's connection
     * rendering / adjacency). The default is all active ports; objects that bury a port in some
     * states override this.
     * @param {("inputPorts"|"outputPorts")} portKind
     * @param {object} data - the record's data (type, direction, ...)
     * @returns {PortDefinition[]}
     */
    surfacePorts(portKind, data) {
        return this.activePorts(portKind, data);
    }
}

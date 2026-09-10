import {NO_EID, AbstractComponent, FieldDefinition} from "@/sim/AbstractComponent.js";
import {tileKeyAt, tileVariantKey, TILE_VARIANT_LIMIT} from "@/common/util.js";
import {LAYER_SURFACE} from "@/common/constants.js";

/**
 * The cell claim on a Position: its layer, the owner object (so a delete releases every cell by
 * query) and per-cell userData (0 for plain footprints; resource cover stores its resource type).
 * Always paired with Position; cells are the entities carrying both.
 */
class OccupancyComponent extends AbstractComponent {

    constructor() {
        super("Occupancy", [
            new FieldDefinition("layer"),
            new FieldDefinition("owner", "i32", NO_EID),
            new FieldDefinition("userData"),
        ]);
    }
}

/**
 * Where an entity sits: a placed object's anchor tile, an edge port's edge, an occupied cell.
 * `direction` is NO_EID for things with no facing (cells).
 */
class PositionComponent extends AbstractComponent {

    constructor() {
        super("Position", [
            new FieldDefinition("x"),
            new FieldDefinition("y"),
            new FieldDefinition("direction", "i32", NO_EID),
        ]);
    }
}

/**
 * Where things sit in the world: the Position and Occupancy components, the layer names their cells
 * are keyed on, and the cell index derived from both. Objects on the same layer collide; different
 * layers coexist, so a belt's underground axis passes beneath a surface footprint.
 */
export class SpatialIndex {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;

        // Layer name <-> int code; the surface layer is code 0, mods register the rest (see
        // registerLayer). Registration order is deterministic per loadout, so codes are stable
        // across save/load.
        this._layerCodes = new Map();
        this._layerNames = [];
        this.registerLayer(LAYER_SURFACE);

        this.positions = engine.components.register(new PositionComponent());
        this.occupancies = engine.components.register(new OccupancyComponent());

        // Occupied cells by "x,y,layer" — a derived index over the two components above, rebuilt from
        // the world on deserialize.
        this._cellByKey = new Map();
    }

    /**
     * Registers a position layer name, returning its stable int code (idempotent).
     * @param {string} name
     * @returns {number}
     */
    registerLayer(name) {
        let code = this._layerCodes.get(name);
        if (code === undefined) {
            code = this._layerNames.length;
            if (code >= TILE_VARIANT_LIMIT) {
                throw new RangeError(`Position layer "${name}" exceeds the ${TILE_VARIANT_LIMIT} the cell index keys on`);
            }
            this._layerCodes.set(name, code);
            this._layerNames.push(name);
        }
        return code;
    }

    /**
     * Places `eid` at (x, y) facing `direction`, attaching Position if it has none.
     * @param {number} eid
     * @param {number} x
     * @param {number} y
     * @param {number} [direction] - Direction or NO_EID
     * @returns {void}
     */
    setPosition(eid, x, y, direction=NO_EID) {
        this.positions.attach(eid);
        this.positions.store.x[eid] = x;
        this.positions.store.y[eid] = y;
        this.positions.store.direction[eid] = direction;
    }

    /**
     * Whether every cell {x, y, layer} is free.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {boolean}
     */
    isEveryCellFree(cells) {
        return cells.every(cell => !this._cellByKey.has(this._getCellKeyAt(cell.x, cell.y, cell.layer)));
    }

    /**
     * userData stored at cell {x, y, layer} or null
     * @param {number} x
     * @param {number} y
     * @param {string} layer
     * @returns {number|null}
     */
    getUserDataAt(x, y, layer) {
        const eid = this._cellByKey.get(this._getCellKeyAt(x, y, layer));
        if (eid === undefined) {
            return null;
        }
        return this.occupancies.store.userData[eid];
    }

    /**
     * object ref owning the cell at {x, y, layer}, or null when the cell is free or unowned.
     * @param {number} x
     * @param {number} y
     * @param {string} layer
     * @returns {number|null}
     */
    getOwnerAt(x, y, layer) {
        const eid = this._cellByKey.get(this._getCellKeyAt(x, y, layer));
        if (eid === undefined) {
            return null;
        }
        const ownerEid = this.occupancies.store.owner[eid];
        if (ownerEid === NO_EID) {
            return null;
        }
        return ownerEid;
    }

    /**
     * Marks each cell occupied, one Position+Occupancy entity per newly taken cell, tagged with
     * `owner` so {@link destroyOwnerCells} can destroy them all on delete.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @param {number} [owner] - the owning object ref
     * @param {number} [userData] - per-cell value read back via {@link getUserDataAt}
     * @returns {void}
     */
    occupy(cells, owner=NO_EID, userData=0) {
        const occupancy = this.occupancies.store;
        for (const cell of cells) {
            const key = this._getCellKeyAt(cell.x, cell.y, cell.layer);
            if (this._cellByKey.has(key)) {
                continue;
            }
            const eid = this.engine.world.addEntity();
            this.setPosition(eid, cell.x, cell.y);
            this.occupancies.attach(eid);
            occupancy.layer[eid] = this._layerCodes.get(cell.layer);
            occupancy.owner[eid] = owner;
            occupancy.userData[eid] = userData;
            this._cellByKey.set(key, eid);
        }
    }

    /**
     * Destroys each cell.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {void}
     */
    destroyCells(cells) {
        for (const cell of cells) {
            const key = this._getCellKeyAt(cell.x, cell.y, cell.layer);
            const eid = this._cellByKey.get(key);
            if (eid !== undefined) {
                this.engine.world.removeEntity(eid);
                this._cellByKey.delete(key);
            }
        }
    }

    /**
     * Destroys every cell an object occupied, keyed by the owner id passed to {@link occupy}.
     * @param {number} owner
     * @returns {void}
     */
    destroyOwnerCells(owner) {
        const occupancy = this.occupancies.store;
        for (const eid of this.getCellEids()) {
            if (occupancy.owner[eid] === owner) {
                this._cellByKey.delete(this._getCellKeyByEid(eid));
                this.engine.world.removeEntity(eid);
            }
        }
    }

    /**
     * The cell entities: those carrying both Position and Occupancy (an edge port has Position alone).
     * @returns {Int32Array}
     */
    getCellEids() {
        return this.engine.world.query([this.positions.store, this.occupancies.store]);
    }

    /**
     * Drops the cell index and rebuilds it from the restored components.
     * @returns {void}
     */
    rebuild() {
        this._cellByKey = new Map();
        for (const eid of this.getCellEids()) {
            this._cellByKey.set(this._getCellKeyByEid(eid), eid);
        }
    }

    /**
     * @private
     * @param {number} eid - a cell entity
     * @returns {number} its index key
     */
    _getCellKeyByEid(eid) {
        const tile = tileKeyAt(this.positions.store.x[eid], this.positions.store.y[eid]);
        return tileVariantKey(tile, this.occupancies.store.layer[eid]);
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @param {string} layer
     * @returns {number} the index key of cell {x, y, layer}
     */
    _getCellKeyAt(x, y, layer) {
        return tileVariantKey(tileKeyAt(x, y), this._layerCodes.get(layer));
    }
}

import {tileId, tileVariantId, TILE_VARIANT_LIMIT} from "@/common/util.js";
import {LAYER_SURFACE} from "@/common/constants.js";
import {NO_EID} from "@/sim/sentinels.js";

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

        // Position component: where an entity sits. Carried by placed objects (their anchor tile), by
        // edge ports (the seam flow crosses), and by every occupied cell. `direction` is NO_EID for
        // things with no facing (cells).
        this.positionDef = engine.components.define("Position", [
            {name: "x"},
            {name: "y"},
            {name: "direction", fill: NO_EID},
        ]);

        /**
         * The Position columns, indexed by eid.
         * @type {Object<string, Int32Array>}
         */
        this.Position = this.positionDef.store;

        // Occupancy component: the cell claim on a Position, tagged with its owner object id (so a
        // delete releases all its cells by query) and per-cell userData read via userDataAt (0 for
        // plain footprints; e.g. resource cover stores its resource type). Always paired with
        // Position — cells are the entities carrying both.
        this.occupancyDef = engine.components.define("Occupancy", [
            {name: "layer"},
            {name: "owner", fill: NO_EID},
            {name: "userData"},
        ]);

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
     * @param {number} [direction] - NO_EID for something with no facing
     * @returns {void}
     */
    setPosition(eid, x, y, direction=NO_EID) {
        this.engine.components.attach(this.positionDef, eid);
        this.Position.x[eid] = x;
        this.Position.y[eid] = y;
        this.Position.direction[eid] = direction;
    }

    /**
     * Whether every cell {x, y, layer} is free.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {boolean}
     */
    cellsFree(cells) {
        return cells.every(cell => !this._cellByKey.has(this._cellKeyAt(cell.x, cell.y, cell.layer)));
    }

    /**
     * The userData stored at cell {x, y, layer}, or null when the cell is free.
     * @param {number} x
     * @param {number} y
     * @param {string} layer
     * @returns {number|null}
     */
    userDataAt(x, y, layer) {
        const eid = this._cellByKey.get(this._cellKeyAt(x, y, layer));
        if (eid === undefined) {
            return null;
        }
        return this.occupancyDef.store.userData[eid];
    }

    /**
     * The object id owning the cell at {x, y, layer}, or null when the cell is free or unowned.
     * @param {number} x
     * @param {number} y
     * @param {string} layer
     * @returns {number|null}
     */
    ownerAt(x, y, layer) {
        const eid = this._cellByKey.get(this._cellKeyAt(x, y, layer));
        if (eid === undefined) {
            return null;
        }
        const owner = this.occupancyDef.store.owner[eid];
        if (owner === NO_EID) {
            return null;
        }
        return owner;
    }

    /**
     * Marks each cell occupied, one Position+Occupancy entity per newly taken cell, tagged with
     * `owner` so {@link destroyOwnerCells} can destroy them all on delete.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @param {number} [owner] - the owning object id
     * @param {number} [userData] - per-cell value read back via {@link userDataAt}
     * @returns {void}
     */
    occupy(cells, owner=NO_EID, userData=0) {
        const occupancy = this.occupancyDef.store;
        for (const cell of cells) {
            const key = this._cellKeyAt(cell.x, cell.y, cell.layer);
            if (this._cellByKey.has(key)) {
                continue;
            }
            const eid = this.engine.world.addEntity();
            this.setPosition(eid, cell.x, cell.y);
            this.engine.components.attach(this.occupancyDef, eid);
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
            const key = this._cellKeyAt(cell.x, cell.y, cell.layer);
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
        const occupancy = this.occupancyDef.store;
        for (const eid of this.cellEids()) {
            if (occupancy.owner[eid] === owner) {
                this._cellByKey.delete(this._cellKey(eid));
                this.engine.world.removeEntity(eid);
            }
        }
    }

    /**
     * The cell entities: those carrying both Position and Occupancy (an edge port has Position alone).
     * @returns {Int32Array}
     */
    cellEids() {
        return this.engine.world.query([this.positionDef.store, this.occupancyDef.store]);
    }

    /**
     * Drops the cell index and rebuilds it from the restored components.
     * @returns {void}
     */
    rebuild() {
        this._cellByKey = new Map();
        for (const eid of this.cellEids()) {
            this._cellByKey.set(this._cellKey(eid), eid);
        }
    }

    /**
     * @private
     * @param {number} eid - a cell entity
     * @returns {number} its index key
     */
    _cellKey(eid) {
        const tile = tileId(this.Position.x[eid], this.Position.y[eid]);
        return tileVariantId(tile, this.occupancyDef.store.layer[eid]);
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @param {string} layer
     * @returns {number} the index key of cell {x, y, layer}
     */
    _cellKeyAt(x, y, layer) {
        return tileVariantId(tileId(x, y), this._layerCodes.get(layer));
    }
}

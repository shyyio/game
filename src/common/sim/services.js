// Engine-level services: instances mods share across module boundaries, provided/resolved on the
// engine under their exported class (engine.provide(ResourceCoverService, ...) /
// engine.resolve(ResourceCoverService)).

function tileKey(x, y) {
    return `${x},${y}`;
}

/**
 * The extraction-tile index over the shared ResourceCover component: tile -> resource type, plus the
 * cover entity lifecycle. Provided by ResourceBehavior; extractors resolve it to bind their resource
 * at spawn.
 */
export class ResourceCoverService {

    /**
     * @param {GameEngine} engine
     * @param {object} def - the ResourceCover component descriptor
     */
    constructor(engine, def) {
        this.engine = engine;
        this.def = def;
        // Extraction tile key -> resource type; derived index over ResourceCover, rebuilt on load.
        this._covers = new Map();
    }

    /**
     * The resource type covering tile (x, y), or null.
     * @param {number} x
     * @param {number} y
     * @returns {number|null}
     */
    coverAt(x, y) {
        const cover = this._covers.get(tileKey(x, y));
        return cover === undefined ? null : cover;
    }

    /**
     * Marks tile (x, y) as an extraction tile of `owner`.
     * @param {number} x
     * @param {number} y
     * @param {number} resourceType
     * @param {number} owner - the owning object's client id
     * @returns {void}
     */
    addCover(x, y, resourceType, owner) {
        const cover = this.def.store;
        const eid = this.engine.createEntity(this.def);
        cover.x[eid] = x;
        cover.y[eid] = y;
        cover.resourceType[eid] = resourceType;
        cover.owner[eid] = owner;
        this._covers.set(tileKey(x, y), resourceType);
    }

    /**
     * Destroys every cover `owner` placed.
     * @param {number} owner
     * @returns {void}
     */
    removeOwner(owner) {
        const cover = this.def.store;
        this.engine.entitiesWith(this.def).forEach(eid => {
            if (cover.owner[eid] === owner) {
                this._covers.delete(tileKey(cover.x[eid], cover.y[eid]));
                this.engine.destroyEntity(eid);
            }
        });
    }

    /**
     * Rebuilds the tile lookup after a load repopulates the world.
     * @returns {void}
     */
    rebuild() {
        this._covers = new Map();
        const cover = this.def.store;
        this.engine.entitiesWith(this.def).forEach(eid => {
            this._covers.set(tileKey(cover.x[eid], cover.y[eid]), cover.resourceType[eid]);
        });
    }
}

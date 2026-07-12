import {SimEngine} from "@/common/sim/SimEngine.js";
import {EcsEngine} from "@/common/sim/EcsEngine.js";
import {rotate} from "@/common/util.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";

/**
 * The bitECS {@link SimEngine}: owns the world, and lets each loaded mod register its ECS content
 * (modules, message handlers, chunk-sync contributors) via {@link AbstractMod#setupEcs}. Generic —
 * it knows no specific content, so it imports nothing from `mods/`.
 */
export class EcsSimEngine extends SimEngine {

    /**
     * @param {ModRegistry} [modRegistry] - mods whose setupEcs registers content on init
     */
    constructor(modRegistry=null) {
        super();
        this.engine = new EcsEngine();
        this.modRegistry = modRegistry;

        // Named module refs, set by mods' setupEcs (used by tests + debugInsertItem).
        this.belts = null;
        this.splitter = null;
        this.machine = null;
        this.resources = null;
        this.extractor = null;
        this.deepExtractor = null;

        // Registered by mods.
        this._messageHandlers = [];
        this._chunkSyncers = [];
        this._inspectors = [];
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        await this.engine.init();
        if (this.modRegistry !== null) {
            // Assign each ObjectDefinition its typeId (registration order) before mods wire up.
            this.modRegistry.definitions;
            this.modRegistry.mods.forEach(mod => mod.setupEcs(this));
        }
    }

    /**
     * A mod registers a message handler (returns true if it handled the message).
     * @param {function(AbstractMessage): boolean} handler
     * @returns {void}
     */
    registerMessageHandler(handler) {
        this._messageHandlers.push(handler);
    }

    /**
     * A mod registers a chunk-sync contributor (chunk -> events).
     * @param {function(number): object[]} contributor
     * @returns {void}
     */
    registerChunkSync(contributor) {
        this._chunkSyncers.push(contributor);
    }

    /**
     * A mod registers an inspect snapshotter (object client id -> InspectHeartbeatEvent or null).
     * @param {function(number): (object|null)} inspector
     * @returns {void}
     */
    registerInspector(inspector) {
        this._inspectors.push(inspector);
    }

    /**
     * The current inspect snapshot for an object, or null if no module owns that client id.
     * @param {number} objectId
     * @returns {object|null}
     */
    inspectSnapshot(objectId) {
        for (let i = 0; i < this._inspectors.length; i += 1) {
            const snapshot = this._inspectors[i](objectId);
            if (snapshot !== null) {
                return snapshot;
            }
        }
        return null;
    }

    /**
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    applyMessage(message) {
        if (message instanceof DeleteObjectMessage) {
            this.untrack(message.id);
        }
        return this._messageHandlers.some(handler => handler(message));
    }

    /**
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        const events = [];
        this._chunkSyncers.forEach(contributor => contributor(chunk).forEach(event => events.push(event)));
        return events;
    }

    /**
     * @param {TickPhase} phase
     * @returns {void}
     */
    tick(phase) {
        this.engine.tick(phase);
    }

    /**
     * @returns {object[]}
     */
    drainEvents() {
        return this.engine.drainEvents();
    }

    /**
     * Resolves the shared edge port for a definition's PortDefinition on an object placed at (x, y)
     * facing `direction` — offset and local direction rotated by the placement.
     * @param {PortDefinition} portVec
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {{port:number, tile:{x:number, y:number}}}
     */
    portFor(portVec, x, y, direction) {
        const r = rotate(portVec, direction);
        const tile = {x: x + r.x, y: y + r.y};
        return {port: this.engine.portAt(tile.x, tile.y, r.direction), tile};
    }

    /**
     * The surface cells a definition occupies at (x, y) facing `direction`.
     * @param {ObjectDefinition} definition
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {{x:number, y:number, layer:string}[]}
     */
    footprint(definition, x, y, direction) {
        return definition.geometry.tiles(direction).map(cell => ({x: x + cell.x, y: y + cell.y, layer: "S"}));
    }

    /**
     * @param {{x:number, y:number, layer:string}[]} footprint
     * @returns {boolean}
     */
    occupancyFree(footprint) {
        return this.engine.occupancyFree(footprint);
    }

    /**
     * Occupies a placed object's footprint, tagged with its client id so a delete frees it.
     * @param {number} clientId
     * @param {{x:number, y:number, layer:string}[]} footprint
     * @returns {void}
     */
    track(clientId, footprint) {
        this.engine.occupy(footprint, clientId);
    }

    /**
     * Frees a deleted object's footprint.
     * @param {number} clientId
     * @returns {void}
     */
    untrack(clientId) {
        this.engine.releaseOwner(clientId);
    }

    /**
     * A serializable snapshot of the whole world.
     * @returns {object}
     */
    serialize() {
        return this.engine.serialize();
    }

    /**
     * Rebuilds the world from a {@link serialize} snapshot.
     * @param {object} snapshot
     * @returns {void}
     */
    deserialize(snapshot) {
        this.engine.deserialize(snapshot);
    }

    /**
     * Debug helper: drops an item onto the first belt path's in-port.
     * @returns {void}
     */
    debugInsertItem() {
        if (this.belts !== null && this.belts.paths.length > 0) {
            this.engine.setPortItem(this.belts.paths[0].inPort, 1);
        }
    }
}

import {addEntity, addComponent} from "bitecs";
import {TickPhase} from "@/common/core.js";
import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";

const EXTRACTOR_CAPACITY = 256;

/**
 * A resource extractor on the bitECS engine: a producer with no input port whose fixed input is the
 * `resourceType` of the resource under it (bound at placement). It looks that up in its recipes and
 * produces the output every `processingTicks` into its one output port (a managed source-less create,
 * same as a machine). Mirrors the SQL EasyExtractor.
 */
export class ExtractorModule {

    /**
     * @param {EcsEngine} engine
     * @param {object} config
     * @param {number} config.processingTicks
     * @param {{resource:number, output:number}[]} config.recipes - resource type -> produced item
     */
    constructor(engine, {processingTicks, recipes}) {
        this.engine = engine;
        this.processingTicks = processingTicks;
        this.recipes = new Map(recipes.map(recipe => [recipe.resource, recipe.output]));

        this.Extractor = {
            out: new Int32Array(EXTRACTOR_CAPACITY),
            resourceType: new Int32Array(EXTRACTOR_CAPACITY).fill(EMPTY),
            remaining: new Int32Array(EXTRACTOR_CAPACITY).fill(EMPTY),
            output: new Int32Array(EXTRACTOR_CAPACITY).fill(EMPTY),
            lastOutput: new Int32Array(EXTRACTOR_CAPACITY).fill(EMPTY),
        };
        this._capacity = EXTRACTOR_CAPACITY;
        this.ids = [];
        this._meta = new Map();
        this._byClientId = new Map();

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._finish());
    }

    /**
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _ensureCapacity(eid) {
        if (eid < this._capacity) {
            return;
        }
        let capacity = this._capacity;
        while (capacity <= eid) {
            capacity *= 2;
        }
        Object.keys(this.Extractor).forEach(column => {
            const fill = column === "out" ? 0 : EMPTY;
            const grown = new Int32Array(capacity).fill(fill);
            grown.set(this.Extractor[column]);
            this.Extractor[column] = grown;
        });
        this._capacity = capacity;
    }

    /**
     * Places an extractor bound to `resourceType`, producing into `outPort` (drawn at `outTile`).
     * @param {number} x
     * @param {number} y
     * @param {number} typeId
     * @param {Direction} direction
     * @param {number} resourceType
     * @param {number} outPort
     * @param {{x:number, y:number}} outTile
     * @returns {number} the eid
     */
    placeExtractor(x, y, typeId, direction, resourceType, outPort, outTile) {
        const eid = addEntity(this.engine.world);
        addComponent(this.engine.world, eid, this.Extractor);
        this._ensureCapacity(eid);
        this.Extractor.out[eid] = outPort;
        this.Extractor.resourceType[eid] = resourceType;
        this.ids.push(eid);

        const clientId = this.engine.allocateObjectId();
        this._meta.set(eid, {clientId, typeId, x, y, direction, outPort, outTile});
        this._byClientId.set(clientId, eid);
        this.engine.registerRenderedPort(outPort, outTile.x, outTile.y);
        this.engine.emitEvent(new EasyObjectInsertEvent(typeId, clientId, x, y, direction, [outPort], null));
        return clientId;
    }

    /**
     * SUBMIT_INTENTS: countdown; an idle extractor bound to a producing resource starts its countdown;
     * at zero it creates the output into its port.
     * @private
     * @returns {void}
     */
    _submitIntents() {
        const P = this.engine.Port.item;
        const E = this.Extractor;
        this.ids.forEach(eid => {
            if (E.remaining[eid] > 0) {
                E.remaining[eid] -= 1;
            }
            if (E.output[eid] === EMPTY && E.resourceType[eid] !== EMPTY && this.recipes.has(E.resourceType[eid])) {
                E.output[eid] = this.recipes.get(E.resourceType[eid]);
                E.remaining[eid] = this.processingTicks;
            }
            if (E.remaining[eid] === 0) {
                this.engine.submitIntent({
                    source: EMPTY,
                    dest: E.out[eid],
                    destEmpty: P[E.out[eid]] === EMPTY,
                    outputItem: E.output[eid],
                    managed: true,
                });
            }
        });
    }

    /**
     * POST_RESOLVE: a delivered extractor records last_output and goes idle (ready to produce again).
     * @private
     * @returns {void}
     */
    _finish() {
        const E = this.Extractor;
        this.ids.forEach(eid => {
            if (this.engine.wasResolvedDest(E.out[eid])) {
                E.lastOutput[eid] = E.output[eid];
                E.output[eid] = EMPTY;
                E.remaining[eid] = EMPTY;
            }
        });
    }

    /**
     * The extractor's current inspect snapshot, or null if no extractor has that client id. The bound
     * resource shows as the sole (memory) input; there are no real input ports.
     * @param {number} clientId
     * @returns {InspectHeartbeatEvent|null}
     */
    inspect(clientId) {
        const eid = this._byClientId.get(clientId);
        if (eid === undefined) {
            return null;
        }
        const E = this.Extractor;
        const resource = E.resourceType[eid];
        const remaining = E.remaining[eid] === EMPTY ? null : E.remaining[eid];
        const outItem = this.engine.Port.item[E.out[eid]];
        let recipeOutput = null;
        if (resource !== EMPTY && this.recipes.has(resource)) {
            recipeOutput = this.recipes.get(resource);
        }
        return new InspectHeartbeatEvent(
            clientId,
            [0],
            [resource === EMPTY ? 0 : resource],
            remaining,
            this.processingTicks,
            outItem === EMPTY ? null : outItem,
            recipeOutput,
        );
    }

    /**
     * @param {number} chunk
     * @returns {EasyObjectSyncEvent[]}
     */
    chunkSync(chunk) {
        const events = [];
        this._meta.forEach((meta, eid) => {
            if (chunkId(meta.x, meta.y) === chunk) {
                const last = this.Extractor.lastOutput[eid];
                events.push(new EasyObjectSyncEvent(
                    meta.typeId, meta.clientId, meta.x, meta.y, meta.direction,
                    [meta.outPort], last === EMPTY ? null : last,
                ));
            }
        });
        return events;
    }

    /**
     * @param {number} clientId
     * @returns {boolean}
     */
    removeExtractorById(clientId) {
        const eid = this._byClientId.get(clientId);
        if (eid === undefined) {
            return false;
        }
        const meta = this._meta.get(eid);
        this.ids = this.ids.filter(id => id !== eid);
        this._meta.delete(eid);
        this._byClientId.delete(clientId);
        this.engine.unregisterRenderedPort(meta.outPort);
        this.engine.emitEvent(new EasyObjectDeleteEvent(meta.typeId, clientId, meta.x, meta.y));
        return true;
    }
}

import {TickPhase} from "@/common/core.js";
import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {EMPTY, NO_EID} from "@/common/sim/EcsEngine.js";

/**
 * A resource extractor on the bitECS engine: a producer with no input port whose fixed input is the
 * `resourceType` of the resource under it (bound at placement). It looks that up in its recipes and
 * produces the output every `processingTicks` into its one output port (a managed source-less create,
 * same as a machine). All state lives in the registered component, so it serializes with no bespoke
 * save code.
 */
export class ExtractorModule {

    /**
     * @param {EcsEngine} engine
     * @param {object} config
     * @param {number} config.processingTicks
     * @param {{resource:number, output:number}[]} config.recipes - resource type -> produced item
     * @param {number} config.typeId - the single object type this module places
     * @param {string} [config.name] - component name (unique per module instance)
     */
    constructor(engine, {processingTicks, recipes, typeId, name="Extractor"}) {
        this.engine = engine;
        this.processingTicks = processingTicks;
        this.typeId = typeId;
        this.recipes = new Map(recipes.map(recipe => [recipe.resource, recipe.output]));

        this.def = engine.defineComponent(name, [
            {name: "out", kind: "eid", fill: NO_EID},
            {name: "resourceType", fill: EMPTY},
            {name: "remaining", fill: EMPTY},
            {name: "output", fill: EMPTY},
            {name: "lastOutput", fill: EMPTY},
            {name: "clientId", fill: NO_EID},
            {name: "x"},
            {name: "y"},
            {name: "direction"},
            {name: "outTileX"},
            {name: "outTileY"},
        ]);
        this.Extractor = this.def.store;

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._finish());
        engine.registerRebuildHook(() => this._resync());
    }

    /**
     * The placed extractor entities.
     * @returns {number[]}
     */
    eids() {
        return this.engine.entitiesWith(this.def);
    }

    /**
     * The extractor entity with client id `clientId`, or undefined.
     * @param {number} clientId
     * @returns {number|undefined}
     */
    eidByClientId(clientId) {
        return this.eids().find(eid => this.Extractor.clientId[eid] === clientId);
    }

    /**
     * Places an extractor bound to `resourceType`, producing into `outPort` (drawn at `outTile`).
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number} resourceType
     * @param {number} outPort
     * @param {{x:number, y:number}} outTile
     * @returns {number} the client id
     */
    placeExtractor(x, y, direction, resourceType, outPort, outTile) {
        const eid = this.engine.createEntity(this.def);
        const E = this.Extractor;
        E.out[eid] = outPort;
        E.resourceType[eid] = resourceType;

        const clientId = this.engine.createObjectId();
        E.clientId[eid] = clientId;
        E.x[eid] = x;
        E.y[eid] = y;
        E.direction[eid] = direction;
        E.outTileX[eid] = outTile.x;
        E.outTileY[eid] = outTile.y;
        this.engine.registerRenderedPort(outPort, outTile.x, outTile.y);
        this.engine.emitEvent(new EasyObjectInsertEvent(this.typeId, clientId, x, y, direction, [outPort], null));
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
        this.eids().forEach(eid => {
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
        this.eids().forEach(eid => {
            if (this.engine.wasResolvedDest(E.out[eid])) {
                E.lastOutput[eid] = E.output[eid];
                E.output[eid] = EMPTY;
                E.remaining[eid] = EMPTY;
            }
        });
    }

    /**
     * Re-registers every extractor's rendered out-port after a load repopulates the world.
     * @private
     * @returns {void}
     */
    _resync() {
        const E = this.Extractor;
        this.eids().forEach(eid => {
            this.engine.registerRenderedPort(E.out[eid], E.outTileX[eid], E.outTileY[eid]);
        });
    }

    /**
     * The extractor's current inspect snapshot, or null if no extractor has that client id. The bound
     * resource shows as the sole (memory) input; there are no real input ports.
     * @param {number} clientId
     * @returns {InspectHeartbeatEvent|null}
     */
    inspect(clientId) {
        const eid = this.eidByClientId(clientId);
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
        const E = this.Extractor;
        this.eids().forEach(eid => {
            if (chunkId(E.x[eid], E.y[eid]) === chunk) {
                const last = E.lastOutput[eid];
                events.push(new EasyObjectSyncEvent(
                    this.typeId, E.clientId[eid], E.x[eid], E.y[eid], E.direction[eid],
                    [E.out[eid]], last === EMPTY ? null : last,
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
        const eid = this.eidByClientId(clientId);
        if (eid === undefined) {
            return false;
        }
        const E = this.Extractor;
        this.engine.unregisterRenderedPort(E.out[eid]);
        this.engine.emitEvent(new EasyObjectDeleteEvent(this.typeId, clientId, E.x[eid], E.y[eid]));
        this.engine.destroyEntity(eid);
        return true;
    }
}

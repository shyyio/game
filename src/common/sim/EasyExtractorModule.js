import {TickPhase} from "@/common/core.js";
import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {EMPTY, NO_EID} from "@/common/sim/GameEngine.js";
import {AbstractEasyModule} from "@/common/sim/AbstractEasyModule.js";

/**
 * A drop-in resource extractor for mods: give it an {@link ObjectDefinition}, a recipe table, and a
 * `bindResource` hook and call {@link EasyExtractorModule#install}; it owns placement, deletion, chunk
 * sync, and inspection with no bespoke mod code. A producer with no input port whose fixed input is
 * the resource bound at placement (via `bindResource`, e.g. the resource cover under the tile); it
 * looks that up in its recipes and produces the output every `processingTicks` into its one output
 * port (a managed source-less create). All state lives in the registered component, so it serializes
 * with no bespoke save code.
 */
export class EasyExtractorModule extends AbstractEasyModule {

    /**
     * @param {GameEngine} engine
     * @param {object} config
     * @param {ObjectDefinition} config.definition - the object type this module places (its typeId,
     *     output port, and geometry drive placement)
     * @param {number} config.processingTicks
     * @param {RecipeDefinition[]} config.recipes - resource type (inputs[0]) -> produced item
     * @param {function(GameEngine, CreateObjectMessage): (number|null)} config.bindResource - the
     *     resource type an extractor placed by this message draws from, or null to reject the placement
     * @param {string} [config.name] - component name (unique per module instance)
     */
    constructor(engine, {definition, processingTicks, recipes, bindResource, name="Extractor"}) {
        super(engine);
        this.definition = definition;
        this.typeId = definition.typeId;
        this.processingTicks = processingTicks;
        this.bindResource = bindResource;
        this.recipes = new Map(recipes.map(recipe => [recipe.inputs[0], recipe.output]));

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
     * @param {number} typeId
     * @returns {boolean}
     */
    handles(typeId) {
        return typeId === this.typeId;
    }

    /**
     * Places this extractor from a CreateObjectMessage: binds the resource under the tile (via
     * `bindResource`), then derives footprint/output port from the definition and marks the footprint
     * occupied. A no-op (still handled) when no resource is bound or the footprint is blocked.
     * @param {GameEngine} sim
     * @param {CreateObjectMessage} message
     * @returns {boolean}
     */
    place(sim, message) {
        const resourceType = this.bindResource(sim, message);
        if (resourceType === null) {
            return true;
        }
        const footprint = sim.footprint(this.definition, message.x, message.y, message.direction);
        if (!sim.occupancyFree(footprint)) {
            return true;
        }
        const output = sim.portFor(this.definition.outputPorts[0], message.x, message.y, message.direction);
        const clientId = this.placeExtractor(message.x, message.y, message.direction, resourceType, output.port, output.tile);
        sim.track(clientId, footprint);
        return true;
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
    remove(clientId) {
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

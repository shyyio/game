import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {TickPhase} from "@/sim/GameEngine.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";
import {METRICS_FACT_TYPE_ITEM_PRODUCED} from "@/common/MetricsFact.js";
import {AbstractBehavior} from "@/sim/behaviors/AbstractBehavior.js";
import {LAYER_RESOURCE} from "@/sim/behaviors/ResourceBehavior.js";

/**
 * A resource extractor: a producer with no input port whose fixed input is the resource covered at
 * its tile (bound at spawn); it looks that up in its recipes and produces the output every
 * `processingTicks` into its one output port (a managed source-less create).
 */
export class ExtractorBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.processingTicks
     * @param {RecipeDefinition[]} config.recipes - resource type (inputs[0]) -> produced item
     */
    constructor({processingTicks, recipes}) {
        super();
        this.processingTicks = processingTicks;
        this.recipes = new Map(recipes.map(recipe => [recipe.inputs[0], recipe.output]));
    }

    install(engine, placed) {
        engine.components.define("Extractor", [
            {name: "out", kind: "eid", fill: NO_EID},
            {name: "resourceType", fill: EMPTY},
            {name: "remaining", kind: "f32", fill: EMPTY},
            // Overshot progress banked past a finished cycle; the next cycle starts this far along.
            {name: "carry", kind: "f32"},
            {name: "output", fill: EMPTY},
            {name: "lastOutput", fill: EMPTY},
            // The countdown length, kept on the row so the submit pass reaches no behavior instance
            // while an extractor is merely counting down.
            {name: "processingTicks"},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => ExtractorBehavior._submitIntents(engine, placed));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => ExtractorBehavior._finish(engine, placed));
    }

    /**
     * Spawns only on a covered extraction tile.
     * @returns {boolean}
     */
    canSpawn(engine, placed, type, message) {
        return engine.space.userDataAt(message.x, message.y, LAYER_RESOURCE) !== null;
    }

    onSpawn(engine, placed, eid, type, message) {
        const def = engine.components.get("Extractor");
        engine.components.attach(def, eid);
        const extractor = def.store;
        const row = def.row(eid);
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        extractor.out[row] = output.port;
        extractor.processingTicks[row] = this.processingTicks;
        const resource = engine.space.userDataAt(message.x, message.y, LAYER_RESOURCE);
        extractor.resourceType[row] = resource;
        // The product is fixed by the bound resource, so show it before the first cycle delivers;
        // a fluid product also types the out-port so an adopting pipe network binds immediately.
        const product = this.recipes.get(resource);
        if (product !== undefined) {
            extractor.lastOutput[row] = product;
            if (engine.isFluid(product)) {
                engine.ports.setFluidSource(output.port, product);
            }
        }
        if (type.outputPorts[0].render) {
            engine.render.registerPort(output.port, output.tile.x, output.tile.y);
        }
    }

    onDespawn(engine, placed, eid) {
        const def = engine.components.get("Extractor");
        const out = def.store.out[def.row(eid)];
        engine.render.unregisterPort(out);
        // The port may outlive the extractor (an adjacent pipe pins it); it no longer produces.
        engine.ports.setFluidSource(out, EMPTY);
    }

    syncData(engine, placed, eid) {
        const def = engine.components.get("Extractor");
        const row = def.row(eid);
        const last = def.store.lastOutput[row];
        let lastOutput = last;
        if (last === EMPTY) {
            lastOutput = null;
        }
        let portIds = [];
        if (this.type.outputPorts[0].render) {
            portIds = [def.store.out[row]];
        }
        return {portIds, lastOutput};
    }

    resyncRenderedPorts(engine, placed, eid) {
        if (!this.type.outputPorts[0].render) {
            return;
        }
        const def = engine.components.get("Extractor");
        const out = def.store.out[def.row(eid)];
        engine.render.registerPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * The extractor's inspect snapshot; the bound resource shows as the sole (memory) input.
     * @returns {InspectHeartbeatEvent}
     */
    inspect(engine, placed, eid, objectId) {
        const def = engine.components.get("Extractor");
        const extractor = def.store;
        const row = def.row(eid);
        const resource = extractor.resourceType[row];
        // The wire carries whole ticks; the fractional countdown stays sim-side.
        let remaining = null;
        if (extractor.remaining[row] !== EMPTY) {
            remaining = Math.ceil(extractor.remaining[row]);
        }
        const outItem = engine.Port.item[extractor.out[row]];
        let recipeOutput = null;
        if (resource !== EMPTY && this.recipes.has(resource)) {
            recipeOutput = this.recipes.get(resource);
        }
        let resourceMemory = resource;
        if (resource === EMPTY) {
            resourceMemory = 0;
        }
        let displayOutItem = outItem;
        if (outItem === EMPTY) {
            displayOutItem = null;
        }
        return new InspectHeartbeatEvent(
            objectId,
            [0],
            [resourceMemory],
            remaining,
            this.processingTicks,
            displayOutItem,
            recipeOutput,
        );
    }

    /**
     * Restores the denormalized countdown length after a load (see MachineBehavior#onRebuild).
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {
        const def = engine.components.get("Extractor");
        const extractor = def.store;
        const eids = def.eids;
        for (let row = 0; row < def.count; row += 1) {
            const behavior = placed.behaviorFor(placed.typeIdOf(eids[row]));
            extractor.processingTicks[row] = behavior.processingTicks;
            const product = behavior.recipes.get(extractor.resourceType[row]);
            if (product !== undefined && engine.isFluid(product)) {
                engine.ports.setFluidSource(extractor.out[row], product);
            }
        }
    }

    /**
     * SUBMIT_INTENTS: countdown; an idle extractor bound to a producing resource starts its countdown;
     * at zero it creates the output into its port.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _submitIntents(engine, placed) {
        const item = engine.Port.item;
        const def = engine.components.get("Extractor");
        const extractor = def.store;
        const eids = def.eids;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (extractor.remaining[row] > 0) {
                const next = extractor.remaining[row] - 1;
                if (next > 0) {
                    extractor.remaining[row] = next;
                } else {
                    // Bank the overshoot; the next cycle starts that far along.
                    extractor.carry[row] -= next;
                    extractor.remaining[row] = 0;
                }
            }
            // Only an idle extractor bound to a resource needs its recipe table, so the behavior hop
            // stays off the countdown path.
            if (extractor.output[row] === EMPTY && extractor.resourceType[row] !== EMPTY) {
                const behavior = placed.behaviorFor(placed.typeIdOf(eids[row]));
                if (behavior.recipes.has(extractor.resourceType[row])) {
                    extractor.output[row] = behavior.recipes.get(extractor.resourceType[row]);
                    const start = extractor.processingTicks[row] - extractor.carry[row];
                    if (start > 0) {
                        extractor.remaining[row] = start;
                        extractor.carry[row] = 0;
                    } else {
                        // Banked progress covers the whole cycle; the surplus keeps carrying.
                        extractor.remaining[row] = 0;
                        extractor.carry[row] = -start;
                    }
                }
            }
            if (extractor.remaining[row] === 0) {
                engine.transfers.submitCreate(extractor.out[row], extractor.output[row], item[extractor.out[row]] === EMPTY);
            }
        }
    }

    /**
     * POST_RESOLVE: a delivered extractor records last_output and goes idle (ready to produce again).
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _finish(engine, placed) {
        const def = engine.components.get("Extractor");
        const extractor = def.store;
        const eids = def.eids;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (engine.transfers.wasDest(extractor.out[row])) {
                const eid = eids[row];
                engine.emitMetrics(
                    METRICS_FACT_TYPE_ITEM_PRODUCED, placed.ownerIdOf(eid), extractor.output[row], 1,
                );
                extractor.lastOutput[row] = extractor.output[row];
                extractor.output[row] = EMPTY;
                extractor.remaining[row] = EMPTY;
            }
        }
    }
}

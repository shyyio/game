import {EMPTY, NO_EID, AbstractComponent, FieldDefinition} from "@/sim/AbstractComponent.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {AbstractBehavior} from "@/common/behaviors/AbstractBehavior.js";
import {SyncedFieldSet, ProductField} from "@/common/SyncedFieldSet.js";
import {LAYER_RESOURCE} from "@/sim/behaviors/ResourceBehavior.js";

/**
 * A resource extractor: its output port, the resource under it and the cycle in progress.
 */
class ExtractorComponent extends AbstractComponent {

    constructor() {
        super("Extractor", [
            new FieldDefinition("outputPort", "eid", NO_EID),
            new FieldDefinition("resourceType", "i32", EMPTY),
            new FieldDefinition("remaining", "f32", EMPTY),
            // Overshot progress banked past a finished cycle; the next cycle starts this far along.
            new FieldDefinition("carry", "f32"),
            new FieldDefinition("output", "item", EMPTY),
            new FieldDefinition("lastOutput", "item", EMPTY),
            // The countdown length, kept on the row so the submit pass reaches no behavior instance
            // while an extractor is merely counting down.
            new FieldDefinition("processingTicks"),
        ], {isSparse: true});
    }
}

const SYNCED_FIELDS = new SyncedFieldSet("Extractor", [new ProductField("lastOutput", EMPTY)]);

/**
 * Ticks every extractor.
 */
class ExtractorSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;
    }

    submitIntents() {
        ExtractorBehavior._submitIntents(this.engine);
    }

    postResolve() {
        ExtractorBehavior._finish(this.engine);
    }
}

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

    get syncedFields() {
        return SYNCED_FIELDS;
    }

    install(engine) {
        engine.components.register(new ExtractorComponent());
        engine.registerSystem(new ExtractorSystem(engine));
    }

    /**
     * Spawns only on a covered extraction tile.
     * @returns {boolean}
     */
    canSpawn(engine, type, message) {
        return engine.space.getUserDataAt(message.x, message.y, LAYER_RESOURCE) !== null;
    }

    onSpawn(engine, eid, type, message) {
        const extractors = engine.components.getComponentByName("Extractor");
        extractors.attach(eid);
        const extractor = extractors.store;
        const row = extractors.getRowByEid(eid);
        const output = engine.getPortAt(type.outputPorts[0], message.x, message.y, message.direction);
        extractor.outputPort[row] = output.port;
        extractor.processingTicks[row] = this.processingTicks;
        const resource = engine.space.getUserDataAt(message.x, message.y, LAYER_RESOURCE);
        extractor.resourceType[row] = resource;
        // The product is fixed by the bound resource, so show it before the first cycle delivers;
        // a fluid product also types the output port so an adopting pipe network binds immediately.
        const product = this.recipes.get(resource);
        if (product !== undefined) {
            extractor.lastOutput[row] = product;
            if (engine.isFluid(product)) {
                engine.ports.setFluidSource(output.port, product);
            }
        }
        if (type.outputPorts[0].render) {
            engine.portItems.addOutputPort(output.port, output.tile.x, output.tile.y);
        }
    }

    onDespawn(engine, eid) {
        const extractors = engine.components.getComponentByName("Extractor");
        const out = extractors.store.outputPort[extractors.getRowByEid(eid)];
        engine.portItems.removeOutputPort(out);
        // The port may outlive the extractor (an adjacent pipe pins it); it no longer produces.
        engine.ports.setFluidSource(out, EMPTY);
    }

    getRenderedPortEids(engine, eid) {
        if (!this.type.outputPorts[0].render) {
            return [];
        }
        const extractors = engine.components.getComponentByName("Extractor");
        return [extractors.store.outputPort[extractors.getRowByEid(eid)]];
    }

    resyncRenderedPorts(engine, eid) {
        if (!this.type.outputPorts[0].render) {
            return;
        }
        const extractors = engine.components.getComponentByName("Extractor");
        const out = extractors.store.outputPort[extractors.getRowByEid(eid)];
        engine.portItems.addOutputPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * The extractor's inspect snapshot; the bound resource shows as the sole (memory) input.
     * @returns {InspectHeartbeatEvent}
     */
    inspect(engine, eid, objectRef) {
        const extractors = engine.components.getComponentByName("Extractor");
        const extractor = extractors.store;
        const row = extractors.getRowByEid(eid);
        const resource = extractor.resourceType[row];
        // The wire carries whole ticks; the fractional countdown stays sim-side.
        let remaining = null;
        if (extractor.remaining[row] !== EMPTY) {
            remaining = Math.ceil(extractor.remaining[row]);
        }
        const outItem = engine.Port.item[extractor.outputPort[row]];
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
            objectRef,
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
     * @returns {void}
     */
    onRebuild(engine) {
        const placed = engine.placed;
        const extractors = engine.components.getComponentByName("Extractor");
        const extractor = extractors.store;
        const eids = extractors.eids;
        for (let row = 0; row < extractors.count; row += 1) {
            const behavior = placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(eids[row]));
            extractor.processingTicks[row] = behavior.processingTicks;
            const product = behavior.recipes.get(extractor.resourceType[row]);
            if (product !== undefined && engine.isFluid(product)) {
                engine.ports.setFluidSource(extractor.outputPort[row], product);
            }
        }
    }

    /**
     * SUBMIT_INTENTS: countdown; an idle extractor bound to a producing resource starts its countdown;
     * at zero it creates the output into its port.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const placed = engine.placed;
        const item = engine.Port.item;
        const extractors = engine.components.getComponentByName("Extractor");
        const extractor = extractors.store;
        const eids = extractors.eids;
        const count = extractors.count;
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
                const behavior = placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(eids[row]));
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
                engine.transfers.submitCreate(extractor.outputPort[row], extractor.output[row], item[extractor.outputPort[row]] === EMPTY);
            }
        }
    }

    /**
     * POST_RESOLVE: a delivered extractor records last_output and goes idle (ready to produce again).
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _finish(engine) {
        const placed = engine.placed;
        const extractors = engine.components.getComponentByName("Extractor");
        const extractor = extractors.store;
        const eids = extractors.eids;
        const count = extractors.count;
        for (let row = 0; row < count; row += 1) {
            if (engine.transfers.isDest(extractor.outputPort[row])) {
                const eid = eids[row];
                engine.itemProduced.notify(placed.getClaimOwnerByEid(eid), extractor.output[row], 1);
                if (extractor.lastOutput[row] !== extractor.output[row]) {
                    extractor.lastOutput[row] = extractor.output[row];
                    engine.sync.markDirty(extractors, eid);
                }
                extractor.output[row] = EMPTY;
                extractor.remaining[row] = EMPTY;
            }
        }
    }
}

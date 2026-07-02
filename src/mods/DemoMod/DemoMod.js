// Reference mod: a 1x1 furnace that "cooks" one input item into an output (or Junk when the item has
// no recipe), sharing its ports with adjacent belts. Just ports + an EasyRecipeProcessor; the rest is Easy*.
import {
    AbstractMod,
    EasyObjectPlacement,
    EasyRecipeProcessor,
    ObjectDefinition,
    PortDefinition,
    RecipeDefinition,
    Direction,
    DeleteObjectMessage,
    MiniMenuEntry,
} from "@/sdk/common.js";
import {EasyObjectTool, EasyObjectGhostLayer, EasyObjectDrawLayer, InspectHighlight} from "@/sdk/client.js";

// The item the furnace cooks and the outputs (a real product + the fallback).
export const DEMO_INPUT_ITEM_TYPE = 7;
export const DEMO_OUTPUT_ITEM_TYPE = 101;
export const DEMO_JUNK_ITEM_TYPE = 102;

export const DemoMachineDefinition = new ObjectDefinition({
    table: "DemoMachine",
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    internalPorts: [],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Machine",
});

const VERB_COOK = 1;

// A Cook furnace: gathers its one input, produces the recipe's output 2 ticks later; install sets
// verb + tickPhases + stateColumns.
new EasyRecipeProcessor({verb: VERB_COOK, processingTicks: 2}).install(DemoMachineDefinition);

export class DemoMod extends AbstractMod {

    constructor() {
        super();
        // Generic place/remove/sync/schema/statements for the 1x1 port-sharing machine.
        this._placement = new EasyObjectPlacement(DemoMachineDefinition);
    }

    get schema() {
        return this._placement.schema;
    }

    get definitions() {
        return {[DemoMachineDefinition.table]: DemoMachineDefinition};
    }

    get recipes() {
        return [
            new RecipeDefinition(VERB_COOK, [DEMO_INPUT_ITEM_TYPE], DEMO_OUTPUT_ITEM_TYPE)
        ];
    }

    get verbFallbacks() {
        return [
            {verb: VERB_COOK, output: DEMO_JUNK_ITEM_TYPE}
        ];
    }

    get extraStatements() {
        return this._placement.statements;
    }

    chunkSyncEvents(chunk) {
        return this._placement.chunkSyncEvents(this.game, chunk);
    }

    onMessage(message) {
        this._placement.handleMessage(this.game, message);
    }
}

// ---- Client mod ----

export class DemoClientMod extends DemoMod {

    constructor() {
        super();
        // Machine sprites; the layer drives its own cache + sprite lifecycle off the object events.
        this._machineLayer = new EasyObjectDrawLayer(DemoMachineDefinition);
        // Machine placement preview, driven by the tool via showGhost/clear.
        this._ghostLayer = new EasyObjectGhostLayer(DemoMachineDefinition);
    }

    get drawLayers() {
        return [this._machineLayer, this._ghostLayer];
    }

    get itemTextures() {
        return {
            [DEMO_OUTPUT_ITEM_TYPE]: "items/1",
            [DEMO_JUNK_ITEM_TYPE]: "items/1",
        };
    }

    tools(client) {
        return [new EasyObjectTool(client, DemoMachineDefinition, this._ghostLayer, true)];
    }

    /**
     * Outlines the machine when its tile is inspected (hovered / mini-menu opened).
     * @returns {InspectHighlight[]}
     */
    onInspect(tileX, tileY, client) {
        const machine = client.cache.objectAt(tileX, tileY, DemoMachineDefinition);
        if (machine === null) {
            return [];
        }
        return [new InspectHighlight(machine.tileX, machine.tileY, machine.data.direction, machine.data.definition)];
    }

    miniMenuEntries(tileX, tileY, session, client) {
        const machine = client.cache.objectAt(tileX, tileY, DemoMachineDefinition);
        if (machine === null) {
            return [];
        }
        return [
            new MiniMenuEntry(
                "Delete machine",
                10,
                () => session.sendMessage(new DeleteObjectMessage(machine.id)),
            ),
        ];
    }
}

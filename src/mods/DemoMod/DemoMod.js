// Reference mod: a 1x1 machine that consumes two input items and, after a delay, produces one output
// item, sharing its ports with adjacent belts. Just ports + an EasyRecipe; the rest is Easy*.
import {
    AbstractMod,
    EasyObjectPlacement,
    EasyRecipe,
    ObjectDefinition,
    PortDefinition,
    Direction,
    DeleteObjectMessage,
    MiniMenuEntry,
} from "@/sdk/common.js";
import {EasyObjectTool, EasyObjectGhostLayer, EasyObjectDrawLayer, InspectHighlight} from "@/sdk/client.js";

// The item type a DemoMachine produces.
export const DEMO_OUTPUT_ITEM_TYPE = 101;

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

// 2 inputs -> 1 output, 2 ticks after the recipe completes; install sets tickPhases + stateColumns.
const demoRecipe = new EasyRecipe({
    inputCount: 2,
    output: DEMO_OUTPUT_ITEM_TYPE,
    processingTicks: 2
});
demoRecipe.install(DemoMachineDefinition);

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
        return {[DEMO_OUTPUT_ITEM_TYPE]: "items/1"};
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

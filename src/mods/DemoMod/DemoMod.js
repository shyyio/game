// Reference mod: a 1x1 furnace that "cooks" one input item into an output (or Junk when the item has
// no recipe), sharing its ports with adjacent belts. The sim runs on the bitECS MachineModule.
import {
    AbstractMod,
    ObjectDefinition,
    PortDefinition,
    Direction,
    DeleteObjectMessage,
    CreateObjectMessage,
    MiniMenuEntry,
} from "@/sdk/common.js";
import {EasyObjectTool, EasyObjectGhostLayer, EasyObjectDrawLayer, InspectHighlight} from "@/sdk/client.js";
import {MachineModule} from "@/common/sim/MachineSystems.js";

// The item the furnace cooks and the outputs (a real product + the fallback).
export const DEMO_INPUT_ITEM_TYPE = 7;
export const DEMO_OUTPUT_ITEM_TYPE = 101;
export const DEMO_JUNK_ITEM_TYPE = 102;

export const DemoMachineDefinition = new ObjectDefinition({
    name: "DemoMachine",
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    internalPorts: [],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Machine",
});

export class DemoMod extends AbstractMod {

    get definitions() {
        return {[DemoMachineDefinition.name]: DemoMachineDefinition};
    }

    /**
     * Registers the DemoMachine ECS module + its message/chunk-sync handlers.
     * @param {GameEngine} sim
     * @returns {void}
     */
    setup(sim) {
        sim.machine = new MachineModule(sim, {
            processingTicks: 2,
            inputCount: 1,
            recipes: [{inputs: [DEMO_INPUT_ITEM_TYPE], output: DEMO_OUTPUT_ITEM_TYPE}],
            fallback: DEMO_JUNK_ITEM_TYPE,
            typeId: DemoMachineDefinition.typeId,
        });
        sim.registerMessageHandler(message => this._ecsMachineMessage(sim, message));
        sim.registerChunkSync(chunk => sim.machine.chunkSync(chunk));
        sim.registerInspector(id => sim.machine.inspect(id));
    }

    /**
     * @private
     * @param {GameEngine} sim
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _ecsMachineMessage(sim, message) {
        if (message instanceof DeleteObjectMessage) {
            return sim.machine.removeMachineById(message.id);
        }
        if (!(message instanceof CreateObjectMessage) || message.typeId !== DemoMachineDefinition.typeId) {
            return false;
        }
        const direction = message.direction;
        const footprint = sim.footprint(DemoMachineDefinition, message.x, message.y, direction);
        if (!sim.occupancyFree(footprint)) {
            return true;
        }
        const input = sim.portFor(DemoMachineDefinition.inputPorts[0], message.x, message.y, direction);
        const output = sim.portFor(DemoMachineDefinition.outputPorts[0], message.x, message.y, direction);
        const handle = sim.machine.placeMachine(message.x, message.y, direction, [input.port], output.port, output.tile);
        sim.track(handle.clientId, footprint);
        return true;
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
            [DEMO_INPUT_ITEM_TYPE]: "items/2",
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
                "Inspect Machine",
                20,
                () => client.inspectObject(machine.id),
            ),
            new MiniMenuEntry(
                "Delete Machine",
                10,
                () => session.sendMessage(new DeleteObjectMessage(machine.id)),
            ),
        ];
    }
}

import {
    AbstractMod,
    DeleteObjectMessage,
    CreateObjectMessage,
} from "@/sdk/common.js";
import {CreateBeltMessage} from "./messages.js";
import {BeltModule} from "./BeltModule.js";
import {SplitterModule} from "@/common/sim/SplitterSystems.js";
import {
    BELT_NORMAL,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
} from "./constants.js";
import {getUndergroundBeltsToCreate, isRamp} from "./geometry.js";
import {BeltDefinition, SplitterDefinition} from "./definitions.js";
import {
    BeltPathRecalculateEvent,
    BeltInsertEvent,
    BeltDeleteEvent,
    BeltSyncEvent,
} from "./events.js";

export class LogisticsMod extends AbstractMod {

    get wireClasses() {
        return [
            CreateBeltMessage,
            BeltInsertEvent,
            BeltDeleteEvent,
            BeltPathRecalculateEvent,
            BeltSyncEvent,
        ];
    }

    get definitions() {
        return {[BeltDefinition.table]: BeltDefinition, [SplitterDefinition.table]: SplitterDefinition};
    }

    /**
     * Registers the belt + splitter ECS modules and their message/chunk-sync handlers.
     * @param {EcsSimEngine} sim
     * @returns {void}
     */
    setupEcs(sim) {
        // Splitter before belt so its POST_RESOLVE seam reads shared ports before the belt writes pops.
        sim.splitter = new SplitterModule(sim.engine);
        sim.belts = new BeltModule(sim.engine);
        sim.registerMessageHandler(message => this._ecsBeltMessage(sim, message));
        sim.registerMessageHandler(message => this._ecsSplitterMessage(sim, message));
        sim.registerChunkSync(chunk => sim.belts.chunkSync(chunk));
        sim.registerChunkSync(chunk => sim.splitter.chunkSync(chunk));
    }

    /**
     * @private
     * @param {EcsSimEngine} sim
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _ecsBeltMessage(sim, message) {
        if (message instanceof CreateBeltMessage) {
            const type = message.beltType === null || message.beltType === undefined ? BELT_NORMAL : message.beltType;
            // A ramp paired to its partner fills the span with undergrounds first, so the whole tunnel
            // collects into one path (the span is empty past the maximum length, leaving them unlinked).
            if (isRamp(type) && message.rampParent !== null && message.rampParent !== undefined) {
                const partner = sim.belts.beltById(message.rampParent);
                if (partner !== null) {
                    const span = getUndergroundBeltsToCreate(partner, {
                        x: message.x, y: message.y, direction: message.direction, type,
                    });
                    span.forEach(cell => sim.belts.placeBelt(cell.x, cell.y, message.direction, BELT_UNDERGROUND));
                }
            }
            sim.belts.placeBelt(message.x, message.y, message.direction, type);
            return true;
        }
        if (message instanceof DeleteObjectMessage) {
            const belt = sim.belts.beltById(message.id);
            if (belt !== null && isRamp(belt.type)) {
                // Deleting a ramp collapses its tunnel: remove the buried undergrounds with it (the paired
                // ramp survives as a standalone). Undergrounds go first so the ramp's run is still intact
                // to walk.
                sim.belts.tunnelUndergrounds(belt).forEach(underground => sim.belts.removeBeltById(underground.id));
                return sim.belts.removeBeltById(message.id);
            }
            return sim.belts.removeBeltById(message.id) || sim.splitter.removeSplitterById(message.id);
        }
        return false;
    }

    /**
     * @private
     * @param {EcsSimEngine} sim
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _ecsSplitterMessage(sim, message) {
        if (!(message instanceof CreateObjectMessage) || message.typeId !== SplitterDefinition.typeId) {
            return false;
        }
        const d = message.direction;
        const footprint = sim.footprint(SplitterDefinition, message.x, message.y, d);
        if (!sim.occupancyFree(footprint)) {
            return true;
        }
        const inA = sim.portFor(SplitterDefinition.inputPorts[0], message.x, message.y, d);
        const inB = sim.portFor(SplitterDefinition.inputPorts[1], message.x, message.y, d);
        const outA = sim.portFor(SplitterDefinition.outputPorts[0], message.x, message.y, d);
        const outB = sim.portFor(SplitterDefinition.outputPorts[1], message.x, message.y, d);
        const handle = sim.splitter.placeSplitter(message.x, message.y, message.typeId, d, {
            in_a: inA.port, in_b: inB.port, out_a: outA.port, out_b: outB.port,
            outATile: outA.tile, outBTile: outB.tile,
        });
        sim.track(handle.clientId, footprint);
        return true;
    }
}

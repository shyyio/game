import {
    AbstractSimMod,
    DeleteObjectMessage,
} from "@/sdk/common.js";
import {CreateBeltMessage} from "./messages.js";
import {Belts} from "./Belts.js";
import {
    BELT_NORMAL,
    BELT_UNDERGROUND,
} from "./constants.js";
import {getUndergroundBeltsToCreate, isRamp} from "./geometry.js";

export class LogisticsSimMod extends AbstractSimMod {

    /**
     * Registers the belt ECS module and its message/chunk-sync handlers. The splitter is fully
     * derived (see SplitterBehavior).
     * @param {GameEngine} sim
     * @returns {void}
     */
    setup(sim) {
        const belts = sim.provide(Belts, new Belts(sim));
        sim.registerMessageHandler(message => this._ecsBeltMessage(belts, message));
        sim.registerChunkSync(chunk => belts.chunkSync(chunk));
    }

    /**
     * @private
     * @param {Belts} belts
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _ecsBeltMessage(belts, message) {
        if (message instanceof CreateBeltMessage) {
            const type = message.beltType === null || message.beltType === undefined ? BELT_NORMAL : message.beltType;
            // A ramp paired to its partner fills the span with undergrounds first, so the whole tunnel
            // collects into one path (the span is empty past the maximum length, leaving them unlinked).
            if (isRamp(type) && message.rampParent !== null && message.rampParent !== undefined) {
                const partner = belts.beltById(message.rampParent);
                if (partner !== null) {
                    const span = getUndergroundBeltsToCreate(partner, {
                        x: message.x, y: message.y, direction: message.direction, type,
                    });
                    span.forEach(cell => belts.placeBelt(cell.x, cell.y, message.direction, BELT_UNDERGROUND));
                }
            }
            belts.placeBelt(message.x, message.y, message.direction, type);
            return true;
        }
        if (message instanceof DeleteObjectMessage) {
            const belt = belts.beltById(message.id);
            if (belt !== null && isRamp(belt.type)) {
                // Deleting a ramp collapses its tunnel: remove the buried undergrounds with it (the paired
                // ramp survives as a standalone). Undergrounds go first so the ramp's run is still intact
                // to walk.
                belts.tunnelUndergrounds(belt).forEach(underground => belts.removeBeltById(underground.id));
                return belts.removeBeltById(message.id);
            }
            return belts.removeBeltById(message.id);
        }
        return false;
    }
}

import {
    LaneBehavior,
    LANE_LEVEL_SURFACE,
    LANE_LEVEL_BURIED,
    LANE_LEVEL_ELEVATED_1,
    LAYER_SURFACE,
    Direction,
    NO_EID,
    CreateObjectMessage,
    DeleteObjectMessage,
    getLaneLevelLayer,
} from "@spup/sdk";
import {
    BELT_UNDERGROUND,
    getBeltKindEntryByKind,
    tunnelStep,
} from "../common/constants.js";
import {BeltUndergroundType} from "../common/objectTypes.js";
import {
    getTunnelPartnerOrNull,
    getUndergroundBeltsToCreate,
    isTunnelMouth,
    isElevatedBeltConnected,
} from "../common/geometry.js";

// Every layer a belt can stand on: the surface, the two buried axes and the elevated one.
const BELT_LAYERS = [
    LAYER_SURFACE,
    getLaneLevelLayer(LANE_LEVEL_BURIED, Direction.UP),
    getLaneLevelLayer(LANE_LEVEL_BURIED, Direction.RIGHT),
    getLaneLevelLayer(LANE_LEVEL_ELEVATED_1, Direction.UP),
];

/**
 * A belt cell of one kind: a lane cell whose kind fixes the levels it takes and gives flow at. A
 * mouth pair's tunnel is derived sim-side: spawning a mouth fills the span to its partner with
 * undergrounds, despawning one collapses them.
 */
export class BeltBehavior extends LaneBehavior {

    /**
     * @param {object} config
     * @param {BeltType} config.beltKind
     */
    constructor({beltKind}) {
        const entry = getBeltKindEntryByKind(beltKind);
        super({inLevel: entry.inLevel, outLevel: entry.outLevel});
        this.beltKind = beltKind;
    }

    canSpawn(engine, type, message) {
        if (this.inLevel <= LANE_LEVEL_SURFACE || this.outLevel <= LANE_LEVEL_SURFACE) {
            return true;
        }
        return isElevatedBeltConnected(
            message.x, message.y, message.direction, this.inLevel,
            (x, y) => BeltBehavior._getBeltsAt(engine, x, y),
        );
    }

    onSpawn(engine, eid, type, message) {
        if (isTunnelMouth(this.beltKind)) {
            this._spawnTunnelBelts(engine, message);
        }
        super.onSpawn(engine, eid, type, message);
    }

    onDespawn(engine, eid) {
        if (isTunnelMouth(this.beltKind)) {
            for (const undergroundEid of this._getTunnelUndergroundEidsByMouthEid(engine, eid)) {
                engine.applyMessage(new DeleteObjectMessage(engine.placed.getObjectRefByEid(undergroundEid)));
            }
        }
        super.onDespawn(engine, eid);
    }

    /**
     * Spawns the undergrounds between a just-placed mouth and its partner; a span past the maximum
     * length stays unfilled, leaving the mouths unlinked, and occupied cells are skipped.
     * @private
     * @param {GameEngine} engine
     * @param {CreateObjectMessage} message
     * @returns {void}
     */
    _spawnTunnelBelts(engine, message) {
        const partner = getTunnelPartnerOrNull(
            message.x, message.y, message.direction, this.beltKind,
            (x, y) => BeltBehavior._getBeltsAt(engine, x, y),
        );
        if (partner === null) {
            return;
        }
        const span = getUndergroundBeltsToCreate(partner, {
            x: message.x,
            y: message.y,
            direction: message.direction,
            type: this.beltKind,
        });
        for (const cell of span) {
            engine.applyMessage(new CreateObjectMessage(BeltUndergroundType.objectTypeId, cell.x, cell.y, message.direction));
        }
    }

    /**
     * The undergrounds buried in a mouth's tunnel, walked from the mouth along its axis.
     * @private
     * @param {GameEngine} engine
     * @param {number} mouthEid
     * @returns {number[]} eids
     */
    _getTunnelUndergroundEidsByMouthEid(engine, mouthEid) {
        const position = engine.Position;
        const direction = position.direction[mouthEid];
        const step = tunnelStep(this.beltKind, direction);
        const layer = getLaneLevelLayer(LANE_LEVEL_BURIED, direction);
        const undergrounds = [];
        let x = position.x[mouthEid] + step.dx;
        let y = position.y[mouthEid] + step.dy;
        for (;;) {
            const eid = engine.placed.getEidAt(x, y, layer);
            if (eid === NO_EID || position.direction[eid] !== direction
                || engine.placed.getBehaviorByTypeId(engine.placed.getObjectTypeIdByEid(eid)).beltKind !== BELT_UNDERGROUND) {
                return undergrounds;
            }
            undergrounds.push(eid);
            x += step.dx;
            y += step.dy;
        }
    }

    /**
     * Every belt standing on a tile, as partner-scan candidates.
     * @private
     * @param {GameEngine} engine
     * @param {number} x
     * @param {number} y
     * @returns {{x: number, y: number, type: BeltType, direction: Direction}[]}
     */
    static _getBeltsAt(engine, x, y) {
        const belts = [];
        for (const layer of BELT_LAYERS) {
            const eid = engine.placed.getEidAt(x, y, layer);
            if (eid === NO_EID) {
                continue;
            }
            const behavior = engine.placed.getBehaviorByTypeId(engine.placed.getObjectTypeIdByEid(eid));
            if (behavior instanceof BeltBehavior) {
                belts.push({x, y, type: behavior.beltKind, direction: engine.Position.direction[eid]});
            }
        }
        return belts;
    }
}

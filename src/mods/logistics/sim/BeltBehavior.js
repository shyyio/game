import {
    LaneBehavior,
    LANE_LEVEL_SURFACE,
    LANE_LEVEL_BURIED,
    LAYER_SURFACE,
    Direction,
    NO_EID,
    CreateObjectMessage,
    DeleteObjectMessage,
    laneLevelLayer,
} from "@spup/sdk";
import {BELT_TUNNEL_DOWN, BELT_TUNNEL_UP, BELT_UNDERGROUND, tunnelStep} from "../common/constants.js";
import {BeltUndergroundType} from "../common/objectTypes.js";
import {findTunnelPartner, getUndergroundBeltsToCreate, isTunnelMouth} from "../common/geometry.js";

/**
 * The level a belt kind takes flow from.
 * @param {BeltType} beltKind
 * @returns {number}
 */
function beltInLevel(beltKind) {
    if (beltKind === BELT_UNDERGROUND || beltKind === BELT_TUNNEL_UP) {
        return LANE_LEVEL_BURIED;
    }
    return LANE_LEVEL_SURFACE;
}

/**
 * The level a belt kind gives flow to.
 * @param {BeltType} beltKind
 * @returns {number}
 */
function beltOutLevel(beltKind) {
    if (beltKind === BELT_UNDERGROUND || beltKind === BELT_TUNNEL_DOWN) {
        return LANE_LEVEL_BURIED;
    }
    return LANE_LEVEL_SURFACE;
}

// Every layer a belt can stand on: the surface and the two buried axes.
const BELT_LAYERS = [
    LAYER_SURFACE,
    laneLevelLayer(LANE_LEVEL_BURIED, Direction.UP),
    laneLevelLayer(LANE_LEVEL_BURIED, Direction.RIGHT),
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
        super({inLevel: beltInLevel(beltKind), outLevel: beltOutLevel(beltKind)});
        this.beltKind = beltKind;
    }

    onSpawn(engine, eid, type, message) {
        if (isTunnelMouth(this.beltKind)) {
            this._fillTunnel(engine, message);
        }
        super.onSpawn(engine, eid, type, message);
    }

    onDespawn(engine, eid) {
        if (isTunnelMouth(this.beltKind)) {
            for (const undergroundEid of this._tunnelUndergrounds(engine, eid)) {
                engine.applyMessage(new DeleteObjectMessage(engine.placed.objectRefOf(undergroundEid)));
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
    _fillTunnel(engine, message) {
        const partner = findTunnelPartner(
            message.x, message.y, message.direction, this.beltKind,
            (x, y) => BeltBehavior._beltsAt(engine, x, y),
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
    _tunnelUndergrounds(engine, mouthEid) {
        const position = engine.Position;
        const direction = position.direction[mouthEid];
        const step = tunnelStep(this.beltKind, direction);
        const layer = laneLevelLayer(LANE_LEVEL_BURIED, direction);
        const undergrounds = [];
        let x = position.x[mouthEid] + step.dx;
        let y = position.y[mouthEid] + step.dy;
        for (;;) {
            const eid = engine.placed.eidAt(x, y, layer);
            if (eid === NO_EID || position.direction[eid] !== direction
                || engine.placed.behaviorFor(engine.placed.objectTypeIdOf(eid)).beltKind !== BELT_UNDERGROUND) {
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
    static _beltsAt(engine, x, y) {
        const belts = [];
        for (const layer of BELT_LAYERS) {
            const eid = engine.placed.eidAt(x, y, layer);
            if (eid === NO_EID) {
                continue;
            }
            const behavior = engine.placed.behaviorFor(engine.placed.objectTypeIdOf(eid));
            if (behavior instanceof BeltBehavior) {
                belts.push({x, y, type: behavior.beltKind, direction: engine.Position.direction[eid]});
            }
        }
        return belts;
    }
}

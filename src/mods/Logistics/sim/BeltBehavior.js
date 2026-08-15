import {AbstractBehavior, CreateObjectMessage, DeleteObjectMessage} from "@spup/sdk";
import {Belts} from "./Belts.js";
import {BeltUndergroundDefinition} from "../common/objectTypes.js";
import {getUndergroundBeltsToCreate, isRamp} from "../common/geometry.js";

/**
 * A belt cell of one kind: spawn/despawn feed the shared Belts path engine; a ramp pair's tunnel
 * is derived sim-side (spawn fills the span, despawn collapses it).
 */
export class BeltBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {BeltType} config.beltKind
     */
    constructor({beltKind}) {
        super();
        this.beltKind = beltKind;
    }

    install(engine, placed) {
        engine.provide(Belts, new Belts(engine));
    }

    onSpawn(engine, placed, eid, type, message) {
        const belts = engine.resolve(Belts);
        if (isRamp(this.beltKind)) {
            this._fillTunnel(engine, belts, message);
        }
        belts.placeBelt(message.x, message.y, message.direction, this.beltKind, placed.objectIdOf(eid));
    }

    onDespawn(engine, placed, eid) {
        const belts = engine.resolve(Belts);
        const belt = belts.beltById(placed.objectIdOf(eid));
        if (belt === null) {
            return;
        }
        if (isRamp(belt.type)) {
            // Buried undergrounds go first, while the ramp's run is still intact to walk.
            for (const underground of belts.tunnelUndergrounds(belt)) {
                engine.applyMessage(new DeleteObjectMessage(underground.id));
            }
        }
        belts.removeBelt(belt.x, belt.y, belt.direction);
    }

    /**
     * Spawns the undergrounds between a just-placed ramp and its partner; a span past the maximum
     * length stays unfilled, leaving the ramps unlinked, and occupied cells are skipped.
     * @private
     * @param {GameEngine} engine
     * @param {Belts} belts
     * @param {CreateObjectMessage} message
     * @returns {void}
     */
    _fillTunnel(engine, belts, message) {
        const partner = belts.rampPartner(message.x, message.y, message.direction, this.beltKind);
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
            engine.applyMessage(new CreateObjectMessage(BeltUndergroundDefinition.typeId, cell.x, cell.y, message.direction));
        }
    }

    /**
     * Re-registers every placed belt with the path engine after a load.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {
        const belts = engine.resolve(Belts);
        belts.resetBelts();
        const def = placed.def;
        const placedObject = def.store;
        const position = engine.Position;
        for (let row = 0; row < def.count; row += 1) {
            const behavior = placed.behaviorFor(placedObject.typeId[row]);
            if (!(behavior instanceof BeltBehavior)) {
                continue;
            }
            const eid = def.eids[row];
            belts.registerBelt({
                x: position.x[eid],
                y: position.y[eid],
                direction: position.direction[eid],
                type: behavior.beltKind,
                id: placedObject.objectId[row],
            });
        }
    }
}

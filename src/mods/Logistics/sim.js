import {AbstractSimMod, chunkId} from "@spup/sdk";
import {SetGateOpenMessage, WireLinkMessage, WireUnlinkMessage} from "./common/messages.js";
import {GateSetEvent} from "./common/events.js";
import {isGateType, isPoleType} from "./common/objectTypes.js";
import {withinPoleRange, CONTROL_WIRE_RECORD} from "./common/constants.js";
import {ControlNetworks} from "./sim/ControlNetworks.js";

/**
 * Handles the Logistics mod's session messages; all tick logic lives in the behaviors.
 */
export class LogisticsSimMod extends AbstractSimMod {

    /**
     * No engine content; everything installs through the behaviors.
     * @param {GameEngine} sim
     * @returns {void}
     */
    setup(sim) {
        this._sim = sim;
    }

    /**
     * @returns {object[]}
     */
    serializeRecords() {
        return this._sim.resolve(ControlNetworks).serializeRecords();
    }

    /**
     * @param {Map<string, object>} tablesByName
     * @returns {void}
     */
    deserializeRecords(tablesByName) {
        this._sim.resolve(ControlNetworks).deserializeRecords(tablesByName.get(CONTROL_WIRE_RECORD));
    }

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof SetGateOpenMessage) {
            this._handleSetGateOpen(message, session, game);
            return true;
        }
        if (message instanceof WireLinkMessage) {
            this._handleWireLink(message, session, game);
            return true;
        }
        if (message instanceof WireUnlinkMessage) {
            this._handleWireUnlink(message, session, game);
            return true;
        }
        return false;
    }

    /**
     * Buffers a toggle for anyone with build rights on the gate's chunk.
     * @param {SetGateOpenMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _handleSetGateOpen(message, session, game) {
        const engine = game.simEngine;
        const eid = engine.placed.eidByObjectId(message.objectId);
        if (eid === undefined) {
            return;
        }
        const typeId = engine.placed.typeIdOf(eid);
        const type = engine.placed.typeFor(typeId);
        if (type === undefined || !isGateType(type)) {
            return;
        }
        const x = engine.Position.x[eid];
        const y = engine.Position.y[eid];
        // Mod messages bypass the core placement gate, so gates check build rights themselves.
        if (!engine.placementAllowed(session.playerId, chunkId(x, y))) {
            // Correct the sender's optimistic flip with the authoritative state.
            const def = engine.component("Gate");
            const row = def.row(eid);
            game.bus.publishTo(session.id, new GateSetEvent(x, y, message.objectId, def.store.open[row], def.store.fluid[row]));
            return;
        }
        engine.placed.behaviorFor(typeId).requestOpen(engine, eid, message.open === 1);
    }

    /**
     * Resolves a wire message's endpoints into pole/device eids; null when the pair is not a
     * pole-pole or device-pole combination, is out of range, or the sender lacks build rights.
     * @param {WireLinkMessage|WireUnlinkMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {{poleEid: number, otherEid: number, otherIsPole: boolean}|null}
     * @private
     */
    _resolveWireEndpoints(message, session, game) {
        const engine = game.simEngine;
        const aEid = engine.placed.eidByObjectId(message.aObjectId);
        const bEid = engine.placed.eidByObjectId(message.bObjectId);
        if (aEid === undefined || bEid === undefined || aEid === bEid) {
            return null;
        }
        const isPole = eid => {
            const type = engine.placed.typeFor(engine.placed.typeIdOf(eid));
            return type !== undefined && isPoleType(type);
        };
        let poleEid = null;
        let otherEid = null;
        if (isPole(aEid)) {
            poleEid = aEid;
            otherEid = bEid;
        } else if (isPole(bEid)) {
            poleEid = bEid;
            otherEid = aEid;
        } else {
            return null;
        }
        const otherIsPole = isPole(otherEid);
        if (!otherIsPole) {
            const otherType = engine.placed.typeFor(engine.placed.typeIdOf(otherEid));
            if (otherType === undefined || otherType.wireAnchor === null) {
                return null;
            }
        }
        const position = engine.Position;
        if (!withinPoleRange(position.x[poleEid], position.y[poleEid], position.x[otherEid], position.y[otherEid])) {
            return null;
        }
        // Mod messages bypass the core placement gate, so wires check build rights themselves.
        if (!engine.placementAllowed(session.playerId, chunkId(position.x[poleEid], position.y[poleEid]))
            || !engine.placementAllowed(session.playerId, chunkId(position.x[otherEid], position.y[otherEid]))) {
            return null;
        }
        return {poleEid, otherEid, otherIsPole};
    }

    /**
     * Adds a wire: pole-pole into the wire set, device-pole into the device's link.
     * @param {WireLinkMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _handleWireLink(message, session, game) {
        const endpoints = this._resolveWireEndpoints(message, session, game);
        if (endpoints === null) {
            return;
        }
        const engine = game.simEngine;
        const networks = engine.resolve(ControlNetworks);
        if (endpoints.otherIsPole) {
            networks.wirePoles(
                engine.placed.objectIdOf(endpoints.poleEid),
                engine.placed.objectIdOf(endpoints.otherEid),
            );
            return;
        }
        networks.link(endpoints.otherEid, engine.placed.objectIdOf(endpoints.poleEid));
    }

    /**
     * Removes the wire between the endpoints; a device detaches only from its own pole.
     * @param {WireUnlinkMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _handleWireUnlink(message, session, game) {
        const endpoints = this._resolveWireEndpoints(message, session, game);
        if (endpoints === null) {
            return;
        }
        const engine = game.simEngine;
        const networks = engine.resolve(ControlNetworks);
        if (endpoints.otherIsPole) {
            networks.unwirePoles(
                engine.placed.objectIdOf(endpoints.poleEid),
                engine.placed.objectIdOf(endpoints.otherEid),
            );
            return;
        }
        if (networks.poleOf(endpoints.otherEid) === engine.placed.objectIdOf(endpoints.poleEid)) {
            networks.unlink(endpoints.otherEid);
        }
    }
}

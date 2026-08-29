import {AbstractSimMod, chunkId} from "@spup/sdk";
import {
    SetGateOpenMessage,
    WireLinkMessage,
    WireUnlinkMessage,
    LogicSnapshotRequestMessage,
    ConfigureLogicRulesMessage,
} from "./common/messages.js";
import {GateSetEvent, LogicSnapshotEvent} from "./common/events.js";
import {isGateType, isTerminalType} from "./common/objectTypes.js";
import {
    withinWireRange,
    LOGIC_WIRE_RECORD,
    LOGIC_RULE_RECORD,
    LOGIC_CONDITION_RECORD,
    LOGIC_RULE_CAP,
    LOGIC_CONDITION_CAP,
    LOGIC_COMPARATOR_AT_LEAST,
    LOGIC_COMPARATOR_NOT,
    LOGIC_CONDITION_KIND_DEVICE,
    LOGIC_CONDITION_KIND_STORED,
} from "./common/constants.js";
import {LogicNetworks} from "./sim/LogicNetworks.js";
import {LogicRule, LogicRules, LogicCondition} from "./sim/LogicRules.js";

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
        return [
            ...this._sim.resolve(LogicNetworks).serializeRecords(),
            ...this._sim.resolve(LogicRules).serializeRecords(),
        ];
    }

    /**
     * @param {Map<string, object>} tablesByName
     * @returns {void}
     */
    deserializeRecords(tablesByName) {
        this._sim.resolve(LogicNetworks).deserializeRecords(tablesByName.get(LOGIC_WIRE_RECORD));
        this._sim.resolve(LogicRules).deserializeRecords(
            tablesByName.get(LOGIC_RULE_RECORD),
            tablesByName.get(LOGIC_CONDITION_RECORD),
        );
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
        if (message instanceof LogicSnapshotRequestMessage) {
            this._sendLogicSnapshot(message, session, game);
            return true;
        }
        if (message instanceof ConfigureLogicRulesMessage) {
            this._configureRules(message, session, game);
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
     * Resolves a wire message's endpoints into eids; null when either endpoint is missing or not
     * wireable, the wire is out of range, or the sender lacks build rights.
     * @param {WireLinkMessage|WireUnlinkMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {{aEid: number, bEid: number}|null}
     * @private
     */
    _resolveWireEndpoints(message, session, game) {
        const engine = game.simEngine;
        const aEid = engine.placed.eidByObjectId(message.aObjectId);
        const bEid = engine.placed.eidByObjectId(message.bObjectId);
        if (aEid === undefined || bEid === undefined || aEid === bEid) {
            return null;
        }
        const wireable = eid => {
            const type = engine.placed.typeFor(engine.placed.typeIdOf(eid));
            return type !== undefined && type.wireAnchor !== null;
        };
        if (!wireable(aEid) || !wireable(bEid)) {
            return null;
        }
        const position = engine.Position;
        if (!withinWireRange(position.x[aEid], position.y[aEid], position.x[bEid], position.y[bEid])) {
            return null;
        }
        // Mod messages bypass the core placement gate, so wires check build rights themselves.
        if (!engine.placementAllowed(session.playerId, chunkId(position.x[aEid], position.y[aEid]))
            || !engine.placementAllowed(session.playerId, chunkId(position.x[bEid], position.y[bEid]))) {
            return null;
        }
        return {aEid, bEid};
    }

    /**
     * Adds a wire between two wireable endpoints.
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
        const networks = engine.resolve(LogicNetworks);
        if (this._wireBreaksTerminalRule(engine, networks, endpoints)) {
            return;
        }
        networks.wire(engine.placed.objectIdOf(endpoints.aEid), engine.placed.objectIdOf(endpoints.bEid));
    }

    /**
     * Whether the wire would leave a network with more than one terminal: it merges two sides
     * (components, or still-unwired single endpoints) that each hold one.
     * @param {GameEngine} engine
     * @param {LogicNetworks} networks
     * @param {{aEid: number, bEid: number}} endpoints
     * @returns {boolean}
     * @private
     */
    _wireBreaksTerminalRule(engine, networks, endpoints) {
        const aObjectId = engine.placed.objectIdOf(endpoints.aEid);
        const bObjectId = engine.placed.objectIdOf(endpoints.bEid);
        const aNetwork = networks.networkOf(aObjectId);
        const bNetwork = networks.networkOf(bObjectId);
        if (aNetwork !== null && bNetwork !== null && aNetwork.id === bNetwork.id) {
            return false;
        }
        return this._sideHasTerminal(engine, aNetwork, aObjectId)
            && this._sideHasTerminal(engine, bNetwork, bObjectId);
    }

    /**
     * Whether a wire endpoint's side holds a terminal: its network when it has one, else the
     * endpoint itself.
     * @param {GameEngine} engine
     * @param {LogicNetwork|null} network
     * @param {number} objectId
     * @returns {boolean}
     * @private
     */
    _sideHasTerminal(engine, network, objectId) {
        if (network === null) {
            return this._isTerminalObject(engine, objectId);
        }
        return this._hasTerminal(engine, network);
    }

    /**
     * @param {GameEngine} engine
     * @param {number} objectId
     * @returns {boolean}
     * @private
     */
    _isTerminalObject(engine, objectId) {
        const eid = engine.placed.eidByObjectId(objectId);
        if (eid === undefined) {
            return false;
        }
        const type = engine.placed.typeFor(engine.placed.typeIdOf(eid));
        return type !== undefined && isTerminalType(type);
    }

    /**
     * Whether the network holds a live terminal.
     * @param {GameEngine} engine
     * @param {LogicNetwork} network
     * @returns {boolean}
     * @private
     */
    _hasTerminal(engine, network) {
        for (const deviceId of network.deviceIds) {
            if (this._isTerminalObject(engine, deviceId)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Removes the wire between the endpoints.
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
        engine.resolve(LogicNetworks).unwire(
            engine.placed.objectIdOf(endpoints.aEid),
            engine.placed.objectIdOf(endpoints.bEid),
        );
    }

    /**
     * Replaces a terminal's rule list for anyone with build rights on its chunk; an over-cap or
     * malformed list is dropped whole.
     * @param {ConfigureLogicRulesMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _configureRules(message, session, game) {
        const engine = game.simEngine;
        const eid = engine.placed.eidByObjectId(message.objectId);
        if (eid === undefined) {
            return;
        }
        const type = engine.placed.typeFor(engine.placed.typeIdOf(eid));
        if (type === undefined || !isTerminalType(type)) {
            return;
        }
        // Mod messages bypass the core placement gate, so rules check build rights themselves.
        const x = engine.Position.x[eid];
        const y = engine.Position.y[eid];
        if (!engine.placementAllowed(session.playerId, chunkId(x, y))) {
            return;
        }
        const ruleCount = message.actionDeviceIds.length;
        if (ruleCount > LOGIC_RULE_CAP) {
            return;
        }
        // Unregistered keys survive into the snapshot and blow up the panel's throwing lookups.
        const registry = engine.modRegistry;
        const rules = [];
        let conditionAt = 0;
        for (let i = 0; i < ruleCount; i += 1) {
            if (!registry.hasLogicKey(message.actionKeys[i])) {
                return;
            }
            const conditionCount = message.conditionCounts[i];
            if (conditionCount < 0 || conditionCount > LOGIC_CONDITION_CAP) {
                return;
            }
            const conditions = [];
            for (let c = conditionAt; c < conditionAt + conditionCount; c += 1) {
                if (message.condKinds[c] !== LOGIC_CONDITION_KIND_DEVICE
                    && message.condKinds[c] !== LOGIC_CONDITION_KIND_STORED) {
                    return;
                }
                if (message.condComparators[c] < LOGIC_COMPARATOR_AT_LEAST
                    || message.condComparators[c] > LOGIC_COMPARATOR_NOT) {
                    return;
                }
                // A stored condition leaves its key at 0; a device condition names a real one.
                if (message.condKinds[c] === LOGIC_CONDITION_KIND_DEVICE
                    && !registry.hasLogicKey(message.condKeys[c])) {
                    return;
                }
                conditions.push(new LogicCondition(
                    message.condKinds[c],
                    message.condDeviceIds[c],
                    message.condItemTypes[c],
                    message.condKeys[c],
                    message.condComparators[c],
                    message.condValues[c],
                ));
            }
            conditionAt += conditionCount;
            rules.push(new LogicRule(
                message.actionDeviceIds[i],
                message.actionKeys[i],
                message.actionValues[i],
                conditions,
            ));
        }
        engine.resolve(LogicRules).setRules(message.objectId, rules);
    }

    /**
     * Answers a terminal's network snapshot directly to the requesting session.
     * @param {LogicSnapshotRequestMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _sendLogicSnapshot(message, session, game) {
        const engine = game.simEngine;
        const eid = engine.placed.eidByObjectId(message.objectId);
        if (eid === undefined) {
            return;
        }
        const type = engine.placed.typeFor(engine.placed.typeIdOf(eid));
        if (type === undefined || !isTerminalType(type)) {
            return;
        }
        const def = engine.component("LogicTerminal");
        const tier = def.store.tier[def.row(eid)];
        const networks = engine.resolve(LogicNetworks);
        const deviceObjectIds = [];
        const deviceTypeIds = [];
        const deviceTileXs = [];
        const deviceTileYs = [];
        let linked = 0;
        const network = networks.networkOf(message.objectId);
        if (network !== null) {
            linked = 1;
            const position = engine.Position;
            for (const deviceId of network.deviceIds) {
                if (deviceId === message.objectId) {
                    continue;
                }
                const deviceEid = engine.placed.eidByObjectId(deviceId);
                if (deviceEid === undefined) {
                    continue;
                }
                deviceObjectIds.push(deviceId);
                deviceTypeIds.push(engine.placed.typeIdOf(deviceEid));
                deviceTileXs.push(position.x[deviceEid]);
                deviceTileYs.push(position.y[deviceEid]);
            }
        }
        const rules = engine.resolve(LogicRules).rulesOf(message.objectId);
        const conditions = rules.flatMap(rule => rule.conditions);
        game.bus.publishTo(session.id, new LogicSnapshotEvent(
            message.objectId, linked, tier, deviceObjectIds, deviceTypeIds, deviceTileXs, deviceTileYs,
            rules.map(rule => rule.actionDeviceId),
            rules.map(rule => rule.actionKey),
            rules.map(rule => rule.actionValue),
            rules.map(rule => Number(rule.suspended)),
            rules.map(rule => rule.conditions.length),
            conditions.map(condition => condition.kind),
            conditions.map(condition => condition.deviceId),
            conditions.map(condition => condition.itemType),
            conditions.map(condition => condition.key),
            conditions.map(condition => condition.comparator),
            conditions.map(condition => condition.value),
        ));
    }
}

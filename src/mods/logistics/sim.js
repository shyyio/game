import {AbstractSimMod, chunkKeyAt} from "@spup/sdk";
import {
    SetGateOpenMessage,
    WireLinkMessage,
    WireUnlinkMessage,
    LogicSnapshotRequestMessage,
    ConfigureLogicRulesMessage,
} from "./common/messages.js";
import {LogicSnapshotEvent} from "./common/events.js";
import {isGateType, isTerminalType} from "./common/objectTypes.js";
import {
    isWithinWireRange,
    LOGIC_WIRE_TABLE,
    LOGIC_RULE_TABLE,
    LOGIC_CONDITION_TABLE,
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
 * @typedef {Object} WireEndpoints
 * @property {number} aEid
 * @property {number} bEid
 */

/**
 * Handles the Logistics mod's session messages; all tick logic lives in the behaviors.
 */
export class LogisticsSimMod extends AbstractSimMod {

    /**
     * No engine content; everything installs through the behaviors.
     * @param {GameEngine} engine
     * @returns {void}
     */
    init(engine) {
        this._engine = engine;
    }

    /**
     * @returns {object[]}
     */
    serializeTables() {
        return [
            ...this._engine.resolve(LogicNetworks).serializeTables(),
            ...this._engine.resolve(LogicRules).serializeTables(),
        ];
    }

    /**
     * @param {Map<string, object>} tablesByName
     * @returns {void}
     */
    deserializeTables(tablesByName) {
        this._engine.resolve(LogicNetworks).deserializeTables(tablesByName.get(LOGIC_WIRE_TABLE));
        this._engine.resolve(LogicRules).deserializeTables(
            tablesByName.get(LOGIC_RULE_TABLE),
            tablesByName.get(LOGIC_CONDITION_TABLE),
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
            this._dispatchSetGateOpen(message, session, game);
            return true;
        }
        if (message instanceof WireLinkMessage) {
            this._dispatchWireLink(message, session, game);
            return true;
        }
        if (message instanceof WireUnlinkMessage) {
            this._dispatchWireUnlink(message, session, game);
            return true;
        }
        if (message instanceof LogicSnapshotRequestMessage) {
            this._publishLogicSnapshot(message, session, game);
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
    _dispatchSetGateOpen(message, session, game) {
        const engine = game.simEngine;
        const eid = engine.placed.getEidByObjectRefOrNull(message.objectRef);
        if (eid === null) {
            return;
        }
        const objectTypeId = engine.placed.getObjectTypeIdByEid(eid);
        const type = engine.placed.getObjectTypeByTypeId(objectTypeId);
        if (type === undefined || !isGateType(type)) {
            return;
        }
        const x = engine.Position.x[eid];
        const y = engine.Position.y[eid];
        // Mod messages bypass the core placement gate, so gates check build rights themselves.
        if (!engine.canBuildIn(session.playerRef, chunkKeyAt(x, y))) {
            // Correct the sender's optimistic flip with the authoritative state.
            game.bus.publishTo(session.sessionRef, engine.sync.getObjectFieldsEventByEid(engine.components.getComponentByName("Gate"), eid));
            return;
        }
        engine.placed.getBehaviorByTypeId(objectTypeId).requestOpen(engine, eid, message.isOpen);
    }

    /**
     * Resolves a wire message's endpoints into eids; null when either endpoint is missing or not
     * wireable, the wire is out of range, or the sender lacks build rights.
     * @param {WireLinkMessage|WireUnlinkMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {WireEndpoints|null}
     * @private
     */
    _resolveWireEndpoints(message, session, game) {
        const engine = game.simEngine;
        const aEid = engine.placed.getEidByObjectRefOrNull(message.aObjectRef);
        const bEid = engine.placed.getEidByObjectRefOrNull(message.bObjectRef);
        if (aEid === null || bEid === null || aEid === bEid) {
            return null;
        }
        const wireable = eid => {
            const type = engine.placed.getObjectTypeByTypeId(engine.placed.getObjectTypeIdByEid(eid));
            return type !== undefined && type.wireAnchor !== null;
        };
        if (!wireable(aEid) || !wireable(bEid)) {
            return null;
        }
        const position = engine.Position;
        if (!isWithinWireRange(position.x[aEid], position.y[aEid], position.x[bEid], position.y[bEid])) {
            return null;
        }
        // Mod messages bypass the core placement gate, so wires check build rights themselves.
        if (!engine.canBuildIn(session.playerRef, chunkKeyAt(position.x[aEid], position.y[aEid]))
            || !engine.canBuildIn(session.playerRef, chunkKeyAt(position.x[bEid], position.y[bEid]))) {
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
    _dispatchWireLink(message, session, game) {
        const endpoints = this._resolveWireEndpoints(message, session, game);
        if (endpoints === null) {
            return;
        }
        const engine = game.simEngine;
        const networks = engine.resolve(LogicNetworks);
        if (this._isWireBreakingTerminalRule(engine, networks, endpoints)) {
            return;
        }
        networks.wire(engine.placed.getObjectRefByEid(endpoints.aEid), engine.placed.getObjectRefByEid(endpoints.bEid));
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
    _isWireBreakingTerminalRule(engine, networks, endpoints) {
        const aObjectRef = engine.placed.getObjectRefByEid(endpoints.aEid);
        const bObjectRef = engine.placed.getObjectRefByEid(endpoints.bEid);
        const aNetwork = networks.getNetworkByObjectRefOrNull(aObjectRef);
        const bNetwork = networks.getNetworkByObjectRefOrNull(bObjectRef);
        if (aNetwork !== null && bNetwork !== null && aNetwork.id === bNetwork.id) {
            return false;
        }
        return this._hasTerminalOnSide(engine, aNetwork, aObjectRef)
            && this._hasTerminalOnSide(engine, bNetwork, bObjectRef);
    }

    /**
     * Whether a wire endpoint's side holds a terminal: its network when it has one, else the
     * endpoint itself.
     * @param {GameEngine} engine
     * @param {LogicNetwork|null} network
     * @param {number} objectRef
     * @returns {boolean}
     * @private
     */
    _hasTerminalOnSide(engine, network, objectRef) {
        if (network === null) {
            return this._isTerminalObject(engine, objectRef);
        }
        return this._hasTerminal(engine, network);
    }

    /**
     * @param {GameEngine} engine
     * @param {number} objectRef
     * @returns {boolean}
     * @private
     */
    _isTerminalObject(engine, objectRef) {
        const eid = engine.placed.getEidByObjectRefOrNull(objectRef);
        if (eid === null) {
            return false;
        }
        const type = engine.placed.getObjectTypeByTypeId(engine.placed.getObjectTypeIdByEid(eid));
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
    _dispatchWireUnlink(message, session, game) {
        const endpoints = this._resolveWireEndpoints(message, session, game);
        if (endpoints === null) {
            return;
        }
        const engine = game.simEngine;
        engine.resolve(LogicNetworks).unwire(
            engine.placed.getObjectRefByEid(endpoints.aEid),
            engine.placed.getObjectRefByEid(endpoints.bEid),
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
        const eid = engine.placed.getEidByObjectRefOrNull(message.objectRef);
        if (eid === null) {
            return;
        }
        const type = engine.placed.getObjectTypeByTypeId(engine.placed.getObjectTypeIdByEid(eid));
        if (type === undefined || !isTerminalType(type)) {
            return;
        }
        // Mod messages bypass the core placement gate, so rules check build rights themselves.
        const x = engine.Position.x[eid];
        const y = engine.Position.y[eid];
        if (!engine.canBuildIn(session.playerRef, chunkKeyAt(x, y))) {
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
                    message.condItemTypeIds[c],
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
        engine.resolve(LogicRules).setRules(message.objectRef, rules);
    }

    /**
     * Answers a terminal's network snapshot directly to the requesting session.
     * @param {LogicSnapshotRequestMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _publishLogicSnapshot(message, session, game) {
        const engine = game.simEngine;
        const eid = engine.placed.getEidByObjectRefOrNull(message.objectRef);
        if (eid === null) {
            return;
        }
        const type = engine.placed.getObjectTypeByTypeId(engine.placed.getObjectTypeIdByEid(eid));
        if (type === undefined || !isTerminalType(type)) {
            return;
        }
        const terminals = engine.components.getComponentByName("LogicTerminal");
        const tier = terminals.store.tier[terminals.getRowByEid(eid)];
        const networks = engine.resolve(LogicNetworks);
        const deviceObjectRefs = [];
        const deviceTypeIds = [];
        const deviceTileXs = [];
        const deviceTileYs = [];
        let linked = 0;
        const network = networks.getNetworkByObjectRefOrNull(message.objectRef);
        if (network !== null) {
            linked = 1;
            const position = engine.Position;
            for (const deviceId of network.deviceIds) {
                if (deviceId === message.objectRef) {
                    continue;
                }
                const deviceEid = engine.placed.getEidByObjectRefOrNull(deviceId);
                if (deviceEid === null) {
                    continue;
                }
                deviceObjectRefs.push(deviceId);
                deviceTypeIds.push(engine.placed.getObjectTypeIdByEid(deviceEid));
                deviceTileXs.push(position.x[deviceEid]);
                deviceTileYs.push(position.y[deviceEid]);
            }
        }
        const rules = engine.resolve(LogicRules).getRulesByObjectRef(message.objectRef);
        const conditions = rules.flatMap(rule => rule.conditions);
        game.bus.publishTo(session.sessionRef, new LogicSnapshotEvent(
            message.objectRef, linked, tier, deviceObjectRefs, deviceTypeIds, deviceTileXs, deviceTileYs,
            rules.map(rule => rule.actionDeviceId),
            rules.map(rule => rule.actionKey),
            rules.map(rule => rule.actionValue),
            rules.map(rule => Number(rule.suspended)),
            rules.map(rule => rule.conditions.length),
            conditions.map(condition => condition.kind),
            conditions.map(condition => condition.deviceId),
            conditions.map(condition => condition.itemTypeId),
            conditions.map(condition => condition.key),
            conditions.map(condition => condition.comparator),
            conditions.map(condition => condition.value),
        ));
    }
}

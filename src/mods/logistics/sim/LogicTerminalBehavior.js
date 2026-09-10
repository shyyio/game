import {AbstractBehavior, AbstractSystem} from "@spup/sdk";
import {
    LOGIC_TIER_BASE,
    LOGIC_CONDITION_KIND_STORED,
    logicComparatorMatches,
} from "../common/constants.js";
import {LogicNetworks} from "./LogicNetworks.js";
import {LogicRules} from "./LogicRules.js";
import {LogicTerminalComponent} from "./LogicTerminalComponent.js";

// Rules evaluate before the gate's buffered toggles apply (-30), so a rule's write lands this tick.
const ORDER_RULES = -40;

/**
 * Runs the rules before any behavior submits, so a toggle lands the same tick.
 */
class LogicRulesSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super(ORDER_RULES);
        this.engine = engine;
    }

    submitIntents() {
        LogicTerminalBehavior._evaluate(this.engine);
    }
}

/**
 * A logic terminal: the config surface of its network. One per network, enforced at wire time
 * (LogisticsSimMod); its rules run every tick, top-down, first writer per device winning.
 */
export class LogicTerminalBehavior extends AbstractBehavior {

    install(engine) {
        engine.components.register(new LogicTerminalComponent());
        engine.provide(LogicRules, new LogicRules());
        engine.registerSystem(new LogicRulesSystem(engine));
    }

    onSpawn(engine, eid, type, message) {
        engine.components.getComponentByName("LogicTerminal").attach(eid);
    }

    onDespawn(engine, eid) {
        engine.resolve(LogicRules).dropTerminal(engine.placed.getObjectRefByEid(eid));
    }

    /**
     * SUBMIT_INTENTS (first): runs every linked terminal's rules top-down. A rule whose devices
     * left the network, died, or refused the key suspends (flagged on the rule, shown in the
     * panel) instead of silently no-opping; the claimed set gives the topmost rule writing a
     * device priority for the tick.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _evaluate(engine) {
        const placed = engine.placed;
        const networks = engine.resolve(LogicNetworks);
        const rulesService = engine.resolve(LogicRules);
        const terminals = engine.components.getComponentByName("LogicTerminal");
        const eids = terminals.eids;
        for (let row = 0; row < terminals.count; row += 1) {
            const eid = eids[row];
            const rules = rulesService.getRulesByObjectRef(placed.getObjectRefByEid(eid));
            if (rules.length === 0) {
                continue;
            }
            const network = networks.findNetworkByObjectRef(placed.getObjectRefByEid(eid));
            const claimed = new Set();
            for (const rule of rules) {
                LogicTerminalBehavior._evaluateRule(engine, network, rule, claimed);
            }
        }
    }

    /**
     * @private
     * @param {GameEngine} engine
     * @param {LogicNetwork|null} network - null when the terminal is unwired
     * @param {LogicRule} rule
     * @param {Set<number>} claimed - device objectRefs already written this evaluation
     * @returns {void}
     */
    static _evaluateRule(engine, network, rule, claimed) {
        const placed = engine.placed;
        rule.suspended = false;
        if (network === null) {
            rule.suspended = true;
            return;
        }
        for (const condition of rule.conditions) {
            const value = LogicTerminalBehavior._getConditionValue(engine, network, condition);
            if (value === null) {
                rule.suspended = true;
                return;
            }
            if (!logicComparatorMatches(condition.comparator, value, condition.value)) {
                return;
            }
        }
        if (claimed.has(rule.actionDeviceId)) {
            return;
        }
        const actionEid = LogicTerminalBehavior._getDeviceEidByObjectRef(engine, network, rule.actionDeviceId);
        if (actionEid === null) {
            rule.suspended = true;
            return;
        }
        const written = placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(actionEid))
            .logicWrite(engine, actionEid, rule.actionKey, rule.actionValue);
        if (!written) {
            rule.suspended = true;
            return;
        }
        claimed.add(rule.actionDeviceId);
    }

    /**
     * A condition's live value: the device key's read, or the stored total for the item type —
     * network-wide, or one container's when the condition names a device; null suspends the rule
     * (dead/unwired device or unexposed key).
     * @private
     * @param {GameEngine} engine
     * @param {LogicNetwork} network
     * @param {LogicCondition} condition
     * @returns {number|null}
     */
    static _getConditionValue(engine, network, condition) {
        const placed = engine.placed;
        if (condition.kind === LOGIC_CONDITION_KIND_STORED) {
            if (condition.deviceId !== 0 && !network.deviceIds.includes(condition.deviceId)) {
                return null;
            }
            let total = 0;
            for (const deviceId of network.deviceIds) {
                if (condition.deviceId !== 0 && deviceId !== condition.deviceId) {
                    continue;
                }
                const eid = placed.findEidByObjectRef(deviceId);
                if (eid === undefined) {
                    continue;
                }
                const stored = placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(eid)).logicStored(engine, eid);
                if (stored !== null && stored.itemTypeId === condition.itemTypeId) {
                    total += stored.amount;
                }
            }
            return total;
        }
        const eid = LogicTerminalBehavior._getDeviceEidByObjectRef(engine, network, condition.deviceId);
        if (eid === null) {
            return null;
        }
        return placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(eid)).logicRead(engine, eid, condition.key);
    }

    /**
     * A rule device's live eid, or null when it left the network or despawned.
     * @private
     * @param {GameEngine} engine
     * @param {LogicNetwork} network
     * @param {number} deviceObjectRef
     * @returns {number|null}
     */
    static _getDeviceEidByObjectRef(engine, network, deviceObjectRef) {
        if (!network.deviceIds.includes(deviceObjectRef)) {
            return null;
        }
        const eid = engine.placed.findEidByObjectRef(deviceObjectRef);
        if (eid === undefined) {
            return null;
        }
        return eid;
    }
}

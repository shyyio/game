import {AbstractBehavior, TickPhase} from "@spup/sdk";
import {
    LOGIC_TIER_BASE,
    LOGIC_CONDITION_KIND_STORED,
    logicComparatorMatches,
} from "../common/constants.js";
import {LogicNetworks} from "./LogicNetworks.js";
import {LogicRules} from "./LogicRules.js";

// Rules evaluate before the gate's buffered toggles apply (-30), so a rule's write lands this tick.
const ORDER_RULES = -40;

/**
 * A logic terminal: the config surface of its network. One per network, enforced at wire time
 * (LogisticsSimMod); its rules run every tick, top-down, first writer per device winning.
 */
export class LogicTerminalBehavior extends AbstractBehavior {

    install(engine, placed) {
        engine.components.define("LogicTerminal", [
            {name: "tier", fill: LOGIC_TIER_BASE},
        ], {sparse: true});
        engine.provide(LogicRules, new LogicRules());
        engine.registerSystem(
            TickPhase.SUBMIT_INTENTS,
            () => LogicTerminalBehavior._evaluate(engine, placed),
            ORDER_RULES,
        );
    }

    onSpawn(engine, placed, eid, type, message) {
        engine.components.attach(engine.components.get("LogicTerminal"), eid);
    }

    onDespawn(engine, placed, eid) {
        engine.resolve(LogicRules).dropTerminal(placed.objectIdOf(eid));
    }

    /**
     * SUBMIT_INTENTS (first): runs every linked terminal's rules top-down. A rule whose devices
     * left the network, died, or refused the key suspends (flagged on the rule, shown in the
     * panel) instead of silently no-opping; the claimed set gives the topmost rule writing a
     * device priority for the tick.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _evaluate(engine, placed) {
        const networks = engine.resolve(LogicNetworks);
        const rulesService = engine.resolve(LogicRules);
        const def = engine.components.get("LogicTerminal");
        const eids = def.eids;
        for (let row = 0; row < def.count; row += 1) {
            const eid = eids[row];
            const rules = rulesService.rulesOf(placed.objectIdOf(eid));
            if (rules.length === 0) {
                continue;
            }
            const network = networks.networkOf(placed.objectIdOf(eid));
            const claimed = new Set();
            for (const rule of rules) {
                LogicTerminalBehavior._evaluateRule(engine, placed, network, rule, claimed);
            }
        }
    }

    /**
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {LogicNetwork|null} network - null when the terminal is unwired
     * @param {LogicRule} rule
     * @param {Set<number>} claimed - device objectIds already written this evaluation
     * @returns {void}
     */
    static _evaluateRule(engine, placed, network, rule, claimed) {
        rule.suspended = false;
        if (network === null) {
            rule.suspended = true;
            return;
        }
        for (const condition of rule.conditions) {
            const value = LogicTerminalBehavior._conditionValue(engine, placed, network, condition);
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
        const actionEid = LogicTerminalBehavior._deviceEid(engine, network, rule.actionDeviceId);
        if (actionEid === null) {
            rule.suspended = true;
            return;
        }
        const written = placed.behaviorFor(placed.typeIdOf(actionEid))
            .logicWrite(engine, placed, actionEid, rule.actionKey, rule.actionValue);
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
     * @param {PlacedObjects} placed
     * @param {LogicNetwork} network
     * @param {LogicCondition} condition
     * @returns {number|null}
     */
    static _conditionValue(engine, placed, network, condition) {
        if (condition.kind === LOGIC_CONDITION_KIND_STORED) {
            if (condition.deviceId !== 0 && !network.deviceIds.includes(condition.deviceId)) {
                return null;
            }
            let total = 0;
            for (const deviceId of network.deviceIds) {
                if (condition.deviceId !== 0 && deviceId !== condition.deviceId) {
                    continue;
                }
                const eid = engine.placed.eidByObjectId(deviceId);
                if (eid === undefined) {
                    continue;
                }
                const stored = placed.behaviorFor(placed.typeIdOf(eid)).logicStored(engine, placed, eid);
                if (stored !== null && stored.itemType === condition.itemType) {
                    total += stored.amount;
                }
            }
            return total;
        }
        const eid = LogicTerminalBehavior._deviceEid(engine, network, condition.deviceId);
        if (eid === null) {
            return null;
        }
        return placed.behaviorFor(placed.typeIdOf(eid)).logicRead(engine, placed, eid, condition.key);
    }

    /**
     * A rule device's live eid, or null when it left the network or despawned.
     * @private
     * @param {GameEngine} engine
     * @param {LogicNetwork} network
     * @param {number} deviceObjectId
     * @returns {number|null}
     */
    static _deviceEid(engine, network, deviceObjectId) {
        if (!network.deviceIds.includes(deviceObjectId)) {
            return null;
        }
        const eid = engine.placed.eidByObjectId(deviceObjectId);
        if (eid === undefined) {
            return null;
        }
        return eid;
    }
}

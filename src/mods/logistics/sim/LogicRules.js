import {
    LOGIC_RULE_TABLE,
    LOGIC_CONDITION_TABLE,
    LOGIC_CONDITION_KIND_DEVICE,
    LOGIC_CONDITION_KIND_STORED,
} from "../common/constants.js";

/**
 * One condition of a rule. DEVICE kind reads `deviceId`'s `key`; STORED kind sums the stored
 * `itemTypeId` across the network, or one container when `deviceId` is set (unused fields hold 0).
 * All fields integer.
 */
export class LogicCondition {

    /**
     * @param {LogicConditionKind} kind
     * @param {number} deviceId
     * @param {number} itemTypeId
     * @param {number} key
     * @param {LogicComparator} comparator
     * @param {number} value
     */
    constructor(kind, deviceId, itemTypeId, key, comparator, value) {
        this.kind = kind;
        this.deviceId = deviceId;
        this.itemTypeId = itemTypeId;
        this.key = key;
        this.comparator = comparator;
        this.value = value;
    }
}

/**
 * One terminal rule: when every condition holds (AND), write the action device's key. All fields
 * integer; `suspended` is runtime-only evaluation state.
 */
export class LogicRule {

    /**
     * @param {number} actionDeviceId
     * @param {number} actionKey
     * @param {number} actionValue
     * @param {LogicCondition[]} conditions
     */
    constructor(actionDeviceId, actionKey, actionValue, conditions) {
        this.actionDeviceId = actionDeviceId;
        this.actionKey = actionKey;
        this.actionValue = actionValue;
        this.conditions = conditions;
        this.suspended = false;
    }
}

/**
 * Per-terminal rule lists, replaced whole per Confirm; persisted as the LogicRule and
 * LogicRuleCondition tables.
 */
export class LogicRules {

    constructor() {
        /**
         * Terminal objectRef -> its rules, top-down priority order.
         * @type {Map<number, LogicRule[]>}
         */
        this._rulesByTerminal = new Map();
    }

    /**
     * Replaces a terminal's whole rule list; an empty list drops the entry.
     * @param {number} terminalObjectRef
     * @param {LogicRule[]} rules
     * @returns {void}
     */
    setRules(terminalObjectRef, rules) {
        if (rules.length === 0) {
            this._rulesByTerminal.delete(terminalObjectRef);
            return;
        }
        this._rulesByTerminal.set(terminalObjectRef, rules);
    }

    /**
     * @param {number} terminalObjectRef
     * @returns {LogicRule[]}
     */
    getRulesByObjectRef(terminalObjectRef) {
        const rules = this._rulesByTerminal.get(terminalObjectRef);
        if (rules === undefined) {
            return [];
        }
        return rules;
    }

    /**
     * Drops a despawned terminal's rules.
     * @param {number} terminalObjectRef
     * @returns {void}
     */
    removeTerminal(terminalObjectRef) {
        this._rulesByTerminal.delete(terminalObjectRef);
    }

    /**
     * @returns {object[]}
     */
    serializeTables() {
        const ruleRows = [];
        const conditionRows = [];
        for (const [terminalObjectRef, rules] of this._rulesByTerminal) {
            for (const [ruleIndex, rule] of rules.entries()) {
                ruleRows.push({
                    terminal_object_id: terminalObjectRef,
                    rule_index: ruleIndex,
                    action_device_id: rule.actionDeviceId,
                    action_key: rule.actionKey,
                    action_value: rule.actionValue,
                });
                for (const [conditionIndex, condition] of rule.conditions.entries()) {
                    conditionRows.push({
                        terminal_object_id: terminalObjectRef,
                        rule_index: ruleIndex,
                        condition_index: conditionIndex,
                        kind: condition.kind,
                        device_id: condition.deviceId,
                        item_type: condition.itemTypeId,
                        key: condition.key,
                        comparator: condition.comparator,
                        value: condition.value,
                    });
                }
            }
        }
        return [{
            name: LOGIC_RULE_TABLE,
            fields: [
                {name: "terminal_object_id", kind: "integer"},
                {name: "rule_index", kind: "integer"},
                {name: "action_device_id", kind: "integer"},
                {name: "action_key", kind: "integer"},
                {name: "action_value", kind: "integer"},
            ],
            rows: ruleRows,
        }, {
            name: LOGIC_CONDITION_TABLE,
            fields: [
                {name: "terminal_object_id", kind: "integer"},
                {name: "rule_index", kind: "integer"},
                {name: "condition_index", kind: "integer"},
                {name: "kind", kind: "integer"},
                {name: "device_id", kind: "integer"},
                {name: "item_type", kind: "item"},
                {name: "key", kind: "integer"},
                {name: "comparator", kind: "integer"},
                {name: "value", kind: "integer"},
            ],
            rows: conditionRows,
        }];
    }

    /**
     * @param {object|undefined} ruleTable
     * @param {object|undefined} conditionTable
     * @returns {void}
     */
    deserializeTables(ruleTable, conditionTable) {
        this._rulesByTerminal.clear();
        if (ruleTable === undefined) {
            return;
        }
        const sortedRules = Array.from(ruleTable.rows).sort((a, b) =>
            a.terminal_object_id - b.terminal_object_id || a.rule_index - b.rule_index);
        for (const row of sortedRules) {
            const rule = new LogicRule(row.action_device_id, row.action_key, row.action_value, []);
            const held = this._rulesByTerminal.get(row.terminal_object_id);
            if (held === undefined) {
                this._rulesByTerminal.set(row.terminal_object_id, [rule]);
            } else {
                held.push(rule);
            }
        }
        if (conditionTable === undefined) {
            return;
        }
        const sortedConditions = Array.from(conditionTable.rows).sort((a, b) =>
            a.terminal_object_id - b.terminal_object_id
            || a.rule_index - b.rule_index
            || a.condition_index - b.condition_index);
        for (const row of sortedConditions) {
            const rules = this._rulesByTerminal.get(row.terminal_object_id);
            if (rules === undefined || rules[row.rule_index] === undefined) {
                continue;
            }
            rules[row.rule_index].conditions.push(new LogicCondition(
                row.kind,
                row.device_id,
                row.item_type,
                row.key,
                row.comparator,
                row.value,
            ));
        }
    }
}

/**
 * A DEVICE condition; the unused itemTypeId field holds 0.
 * @param {number} deviceId
 * @param {number} key
 * @param {number} comparator
 * @param {number} value
 * @returns {LogicCondition}
 */
export function deviceCondition(deviceId, key, comparator, value) {
    return new LogicCondition(LOGIC_CONDITION_KIND_DEVICE, deviceId, 0, key, comparator, value);
}

/**
 * A STORED condition; deviceId 0 sums the whole network, else one container. The unused key
 * field holds 0.
 * @param {number} itemTypeId
 * @param {number} comparator
 * @param {number} value
 * @param {number} [deviceId]
 * @returns {LogicCondition}
 */
export function storedCondition(itemTypeId, comparator, value, deviceId = 0) {
    return new LogicCondition(LOGIC_CONDITION_KIND_STORED, deviceId, itemTypeId, 0, comparator, value);
}

import {
    LOGIC_RULE_RECORD,
    LOGIC_CONDITION_RECORD,
    LOGIC_CONDITION_KIND_DEVICE,
    LOGIC_CONDITION_KIND_STORED,
} from "../common/constants.js";

/**
 * One condition of a rule. DEVICE kind reads `deviceId`'s `key`; STORED kind sums the stored
 * `itemType` across the network, or one container when `deviceId` is set (unused fields hold 0).
 * All fields integer.
 */
export class LogicCondition {

    /**
     * @param {number} kind - a LOGIC_CONDITION_KIND_* value
     * @param {number} deviceId
     * @param {number} itemType
     * @param {number} key
     * @param {number} comparator - a LOGIC_COMPARATOR_* value
     * @param {number} value
     */
    constructor(kind, deviceId, itemType, key, comparator, value) {
        this.kind = kind;
        this.deviceId = deviceId;
        this.itemType = itemType;
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
 * LogicRuleCondition record tables.
 */
export class LogicRules {

    constructor() {
        /**
         * Terminal objectId -> its rules, top-down priority order.
         * @type {Map<number, LogicRule[]>}
         */
        this._rulesByTerminal = new Map();
    }

    /**
     * Replaces a terminal's whole rule list; an empty list drops the entry.
     * @param {number} terminalObjectId
     * @param {LogicRule[]} rules
     * @returns {void}
     */
    setRules(terminalObjectId, rules) {
        if (rules.length === 0) {
            this._rulesByTerminal.delete(terminalObjectId);
            return;
        }
        this._rulesByTerminal.set(terminalObjectId, rules);
    }

    /**
     * @param {number} terminalObjectId
     * @returns {LogicRule[]}
     */
    rulesOf(terminalObjectId) {
        const rules = this._rulesByTerminal.get(terminalObjectId);
        if (rules === undefined) {
            return [];
        }
        return rules;
    }

    /**
     * Drops a despawned terminal's rules.
     * @param {number} terminalObjectId
     * @returns {void}
     */
    dropTerminal(terminalObjectId) {
        this._rulesByTerminal.delete(terminalObjectId);
    }

    /**
     * @returns {object[]}
     */
    serializeRecords() {
        const ruleRows = [];
        const conditionRows = [];
        for (const [terminalObjectId, rules] of this._rulesByTerminal) {
            for (const [ruleIndex, rule] of rules.entries()) {
                ruleRows.push({
                    terminal_object_id: terminalObjectId,
                    rule_index: ruleIndex,
                    action_device_id: rule.actionDeviceId,
                    action_key: rule.actionKey,
                    action_value: rule.actionValue,
                });
                for (const [conditionIndex, condition] of rule.conditions.entries()) {
                    conditionRows.push({
                        terminal_object_id: terminalObjectId,
                        rule_index: ruleIndex,
                        condition_index: conditionIndex,
                        kind: condition.kind,
                        device_id: condition.deviceId,
                        item_type: condition.itemType,
                        key: condition.key,
                        comparator: condition.comparator,
                        value: condition.value,
                    });
                }
            }
        }
        return [{
            name: LOGIC_RULE_RECORD,
            fields: [
                {name: "terminal_object_id", kind: "integer"},
                {name: "rule_index", kind: "integer"},
                {name: "action_device_id", kind: "integer"},
                {name: "action_key", kind: "integer"},
                {name: "action_value", kind: "integer"},
            ],
            rows: ruleRows,
        }, {
            name: LOGIC_CONDITION_RECORD,
            fields: [
                {name: "terminal_object_id", kind: "integer"},
                {name: "rule_index", kind: "integer"},
                {name: "condition_index", kind: "integer"},
                {name: "kind", kind: "integer"},
                {name: "device_id", kind: "integer"},
                {name: "item_type", kind: "integer"},
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
    deserializeRecords(ruleTable, conditionTable) {
        this._rulesByTerminal.clear();
        if (ruleTable === undefined) {
            return;
        }
        const sortedRules = [...ruleTable.rows].sort((a, b) =>
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
        const sortedConditions = [...conditionTable.rows].sort((a, b) =>
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
 * A DEVICE condition; the unused itemType field holds 0.
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
 * @param {number} itemType
 * @param {number} comparator
 * @param {number} value
 * @param {number} [deviceId]
 * @returns {LogicCondition}
 */
export function storedCondition(itemType, comparator, value, deviceId = 0) {
    return new LogicCondition(LOGIC_CONDITION_KIND_STORED, deviceId, itemType, 0, comparator, value);
}

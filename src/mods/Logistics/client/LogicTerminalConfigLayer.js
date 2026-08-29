import {ManagedPanel, UIPanel, ConnectedPanelLayer, TextRole, TILE_SIZE, buildPanelButton, buildIconButton, panelText, PanelStack, ScrollView, IconPicker, IconPickerEntry, ROW_HEIGHT, Container, Graphics, Rectangle, TextInput} from "@spup/sdk/client";
import {PANEL_TINT, PANEL_TITLE_TEXT, ACTIVE_ACCENT, HudLayer} from "@spup/sdk/client";
import {
    LOGIC_RULE_CAP,
    LOGIC_CONDITION_CAP,
    LOGIC_COMPARATOR_EXACTLY,
    LOGIC_COMPARATOR_AT_LEAST,
    LOGIC_CONDITION_KIND_STORED,
} from "../common/constants.js";
import {LogicRule, LogicCondition, deviceCondition, storedCondition} from "../sim/LogicRules.js";
import {LogicTerminalDefinition} from "../common/objectTypes.js";

const PANEL_WIDTH = 400;
const MAX_DEVICE_ROWS = 4;
const DROPDOWN_WIDTH = 300;
const DROPDOWN_ROWS = 8;
// The slot the "when"/"and" conjunction sits in, ahead of a condition's editors.
const CONJUNCTION_COLUMN_WIDTH = 50;
// Comparator glyphs indexed by LOGIC_COMPARATOR_* value.
const COMPARATOR_LABELS = ["≥", "≤", "=", "≠"];
// Suspended rules mark red (blocked).
const SUSPENDED_TINT = 0xcc4444;
const INACTIVE_TINT = 0x777777;
const SWATCH_SIZE = 14;
// New stored/numeric conditions start here; the number box adjusts.
const DEFAULT_STORED_VALUE = 1;
const VALUE_INPUT_WIDTH = 80;
const VALUE_INPUT_MAX_DIGITS = 7;
// The rules box scrolls past this height instead of growing the panel.
const RULES_VIEWPORT_HEIGHT = 220;
// Clearance between a dropdown and its button / the screen edge.
const DROPDOWN_GAP = 4;
const DROPDOWN_MARGIN = 8;

/**
 * One entry of a dropdown list: its label and what picking it does.
 */
class DropdownOption {

    /**
     * @param {string} label
     * @param {function(): void} pick
     */
    constructor(label, pick) {
        this.label = label;
        this.pick = pick;
    }
}

/**
 * One network device as the editors see it: label, position, and its logic key lists.
 */
class PickerDevice {

    /**
     * @param {number} objectId
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} ordinal - 1-based rank among the network's devices of this type
     */
    constructor(objectId, type, tileX, tileY, ordinal) {
        this.objectId = objectId;
        this.type = type;
        this.tileX = tileX;
        this.tileY = tileY;
        this.ordinal = ordinal;
        this.readKeys = type.behavior.logicReadKeys();
        this.writeKeys = type.behavior.logicWriteKeys();
    }

    /**
     * @returns {string} e.g. "Gate #2"
     */
    get label() {
        return `${this.type.label} #${this.ordinal}`;
    }
}

/**
 * One storable item as the pickers see it.
 */
class StorableItem {

    /**
     * @param {number} itemType
     * @param {ItemDefinition} definition
     */
    constructor(itemType, definition) {
        this.itemType = itemType;
        this.name = definition.name;
        this.texture = definition.texture;
        this.tint = definition.tint;
    }
}

/**
 * Shows a placed Logic Terminal's network (wired state, tier, devices) and edits its rules
 * inline, train-schedule style: each rule is an action dropdown with AND'ed condition rows under
 * it, options picked from pop-up dropdown lists. Every edit sends the whole list.
 */
export class LogicTerminalConfigLayer extends ConnectedPanelLayer {

    /**
     * @param {Application} app
     * @param {ClientCache} cache
     * @param {ModRegistry} modRegistry
     */
    constructor(
        app,
        cache,
        modRegistry,
    ) {
        super(app);
        this._cache = cache;
        this._modRegistry = modRegistry;
        this._objects = cache.view("objects");
        this.textureRegistry = null;
        this.zIndex = HudLayer.PANEL;
        this.visible = false;
        this._managed = new ManagedPanel();

        // The local rule list mirrors the last snapshot; edits send whole and re-sync.
        this._rules = [];
        // The rules box's number inputs, re-collected per rebuild for DOM clipping.
        this._valueInputs = [];
        // Every edit rebuilds the panel, which builds a fresh rules ScrollView; its offset is
        // carried across so opening a dropdown or adding a rule never scrolls the box away.
        this._rulesScroll = null;
        this._rulesScrollY = 0;
        /**
         * The open dropdown: {kind: "list", options} or {kind: "icons", entries, selectedId,
         * onPick}, or null.
         * @type {object|null}
         */
        this._dropdown = null;
        // The opening button's screen rect, so the list drops from it.
        this._dropdownAnchor = null;
        this._overlay = null;

        this._connectors.set("terminal", () => this._managed.panel, () => {
            const objectId = this._targetObjectId();
            const entry = objectId === null ? null : this._objects.get(objectId);
            if (entry === null) {
                return null;
            }
            return {x: entry.tileX, y: entry.tileY};
        });

        cache.subscribe("logistics.configTarget", value => {
            if (value === null) {
                this._hide();
            } else {
                this._rules = [];
                this._dropdown = null;
                this._rulesScroll = null;
                this._rulesScrollY = 0;
                this._show();
            }
        });
        cache.subscribe("logistics.logicSnapshot", () => {
            if (this.visible) {
                this._applySnapshot();
                this._rebuild();
            }
        });
    }

    /**
     * @private
     * @returns {number|null}
     */
    _targetObjectId() {
        return this._cache.get("logistics.configTarget");
    }

    /**
     * @private
     * @returns {LogicSnapshotEvent|null}
     */
    _snapshot() {
        return this._cache.get("logistics.logicSnapshot");
    }

    /**
     * Repaints for the current theme; the engine calls this on any HUD layer defining it.
     * @returns {void}
     */
    restyle() {
        if (this.visible) {
            this._rebuild();
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _show() {
        this.visible = true;
        this._rebuild();
    }

    /**
     * @private
     * @returns {void}
     */
    _hide() {
        this.visible = false;
        this._dropdown = null;
        this._rulesScroll = null;
        this._clearOverlay();
        this._managed.hide();
    }

    /**
     * Seeds the local rule list from a fresh snapshot.
     * @private
     * @returns {void}
     */
    _applySnapshot() {
        const snapshot = this._snapshot();
        if (snapshot === null) {
            return;
        }
        let conditionAt = 0;
        this._rules = snapshot.ruleActionDeviceIds.map((actionDeviceId, i) => {
            const conditions = [];
            for (let c = conditionAt; c < conditionAt + snapshot.ruleConditionCounts[i]; c += 1) {
                conditions.push(new LogicCondition(
                    snapshot.condKinds[c],
                    snapshot.condDeviceIds[c],
                    snapshot.condItemTypes[c],
                    snapshot.condKeys[c],
                    snapshot.condComparators[c],
                    snapshot.condValues[c],
                ));
            }
            conditionAt += snapshot.ruleConditionCounts[i];
            const rule = new LogicRule(
                actionDeviceId,
                snapshot.ruleActionKeys[i],
                snapshot.ruleActionValues[i],
                conditions,
            );
            rule.suspended = snapshot.ruleSuspended[i] === 1;
            return rule;
        });
    }

    /**
     * Sends the local rule list whole; the answering snapshot re-syncs the panel.
     * @private
     * @returns {void}
     */
    _sendRules() {
        this._cache.writer("logistics").configureLogicRules(this._targetObjectId(), this._rules);
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuild() {
        const objectId = this._targetObjectId();
        if (objectId === null) {
            return;
        }
        if (this._rulesScroll !== null) {
            this._rulesScrollY = this._rulesScroll.scrollY;
            this._rulesScroll = null;
        }
        const snapshot = this._snapshot();

        const panel = this._managed.show({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: "Logic Terminal",
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            onClose: () => this._cache.writer("logistics").closeTerminalConfig(),
        }, UIPanel.centerPosition(this._app, PANEL_WIDTH), (stack) => this._buildBody(stack, snapshot));
        this.addChild(panel);
        this._buildOverlay();
    }

    /**
     * @private
     * @param {PanelStack} stack
     * @param {LogicSnapshotEvent|null} snapshot
     * @returns {void}
     */
    _buildBody(stack, snapshot) {
        if (snapshot === null) {
            stack.text("Loading...");
            return;
        }
        if (snapshot.linked === 0) {
            stack.text("Not wired to a logic network.", TextRole.MUTED);
            return;
        }
        stack.header(`Devices (${snapshot.deviceObjectIds.length})`);
        stack.scrollSection(this.viewport, this._pickerDevices(snapshot), (device) => ({
            label: device.label,
            trailingLabel: `${device.tileX}, ${device.tileY}`,
            onRowClick: () => this._glideToDevice(device.tileX, device.tileY),
        }), "No devices wired to this network.", {visibleRows: MAX_DEVICE_ROWS});
        stack.gap();

        stack.header(`Rules (${this._rules.length}/${LOGIC_RULE_CAP})`);
        this._buildRulesBox(stack, snapshot);
        stack.gap();
        stack.row((row) => {
            const actions = this._addActionOptionsFor(snapshot);
            const add = buildPanelButton(this.textureRegistry, "Add action", ACTIVE_ACCENT, () => {
                this._openDropdown(actions, add);
            }, this._rules.length >= LOGIC_RULE_CAP || actions.length === 0);
            row.leading(add);
        });
    }

    /**
     * The rules in their own scroll box, so a long list never grows the panel.
     * @private
     * @param {PanelStack} stack
     * @param {LogicSnapshotEvent} snapshot
     * @returns {void}
     */
    _buildRulesBox(stack, snapshot) {
        this._valueInputs = [];
        const rulesStack = new PanelStack(this.textureRegistry, ScrollView.contentWidthFor(stack.contentWidth));
        if (this._rules.length === 0) {
            rulesStack.text("No rules yet.", TextRole.MUTED);
        }
        for (const [index, rule] of this._rules.entries()) {
            this._buildRuleRows(rulesStack, snapshot, rule, index);
        }
        const height = rulesStack.contentHeight;
        if (height <= RULES_VIEWPORT_HEIGHT) {
            stack.block(rulesStack, height);
            return;
        }
        const scrollView = new ScrollView(this.textureRegistry, this.viewport, stack.contentWidth, RULES_VIEWPORT_HEIGHT);
        scrollView.content.addChild(rulesStack);
        scrollView.setContentHeight(height);
        scrollView.scrollY = this._rulesScrollY;
        this._rulesScroll = scrollView;
        stack.block(scrollView, RULES_VIEWPORT_HEIGHT);
        // The scroll mask cannot clip the DOM inputs; mirror it onto them.
        for (const input of this._valueInputs) {
            input.setClip(() => scrollView.getBounds());
        }
    }

    /**
     * Opens the option list under the button that asked for it.
     * @private
     * @param {DropdownOption[]} options
     * @param {Container} button
     * @returns {void}
     */
    _openDropdown(options, button) {
        this._anchorTo(button);
        this._dropdown = {kind: "list", options};
        this._rebuild();
    }

    /**
     * Opens the icon grid under the button that asked for it.
     * @private
     * @param {IconPickerEntry[]} entries
     * @param {number|null} selectedId
     * @param {function(number): void} onPick
     * @param {Container} button
     * @returns {void}
     */
    _openIconPicker(entries, selectedId, onPick, button) {
        this._anchorTo(button);
        this._dropdown = {kind: "icons", entries, selectedId, onPick};
        this._rebuild();
    }

    /**
     * @private
     * @param {Container} button
     * @returns {void}
     */
    _anchorTo(button) {
        const bounds = button.getBounds();
        this._dropdownAnchor = {x: bounds.x, top: bounds.y, bottom: bounds.y + bounds.height};
    }

    /**
     * One rule's inline block: the action dropdown row, a row per condition, and "+ condition".
     * @private
     * @param {PanelStack} stack
     * @param {LogicSnapshotEvent} snapshot
     * @param {LogicRule} rule
     * @param {number} index
     * @returns {void}
     */
    _buildRuleRows(stack, snapshot, rule, index) {
        stack.row((row) => {
            if (rule.suspended) {
                row.leading(new Graphics()
                    .roundRect(0, 0, SWATCH_SIZE, SWATCH_SIZE, 3)
                    .fill(SUSPENDED_TINT));
            }
            const verb = buildPanelButton(
                this.textureRegistry,
                `${this._actionVerb(rule)} ▾`,
                ACTIVE_ACCENT,
                () => this._openDropdown(this._actionVerbOptionsFor(snapshot, rule), verb),
            );
            row.leading(verb);
            const device = this._deviceById(snapshot, rule.actionDeviceId);
            let deviceTexture = LogicTerminalDefinition.textureName;
            if (device !== undefined) {
                deviceTexture = device.type.textureName;
            }
            // Only devices holding the rule's own key: the verb stays true of whatever is picked.
            const target = buildIconButton(this.textureRegistry, deviceTexture, 0xffffff, ACTIVE_ACCENT,
                () => this._openDropdown(
                    this._devicesWithWriteKey(snapshot, rule.actionKey).map(held => new DropdownOption(held.label, () => {
                        rule.actionDeviceId = held.objectId;
                        this._sendRules();
                    })), target));
            row.leading(target);
            row.trailing(this._removeButton(() => {
                this._rules.splice(index, 1);
                this._sendRules();
            }));
        });
        for (const [conditionIndex, condition] of rule.conditions.entries()) {
            this._buildConditionRows(stack, snapshot, rule, condition, conditionIndex);
        }
        stack.row((row) => {
            const conditionTypes = this._conditionTypeOptionsFor(snapshot, rule);
            const add = buildPanelButton(this.textureRegistry, "+ condition", INACTIVE_TINT, () => {
                this._openDropdown(conditionTypes, add);
            }, rule.conditions.length >= LOGIC_CONDITION_CAP || conditionTypes.length === 0);
            row.indent();
            row.leading(add);
        });
    }

    /**
     * One condition's rows, per kind: a stated device condition is a device picker plus a state
     * dropdown; a stored condition is (container picker +) item picker, then a comparator glyph
     * and number box on a second row.
     * @private
     * @param {PanelStack} stack
     * @param {LogicSnapshotEvent} snapshot
     * @param {LogicRule} rule
     * @param {LogicCondition} condition
     * @param {number} conditionIndex
     * @returns {void}
     */
    _buildConditionRows(stack, snapshot, rule, condition, conditionIndex) {
        stack.row((row) => {
            let word = "and";
            if (conditionIndex === 0) {
                word = "when";
            }
            row.indent();
            // A fixed slot, so "when" and "and" rows line their editors up down the rule.
            row.column(panelText(word, TextRole.MUTED), CONJUNCTION_COLUMN_WIDTH);
            for (const button of this._conditionButtons(snapshot, condition)) {
                row.leading(button);
            }
            if (this._conditionIsNumeric(condition)) {
                const comparator = buildPanelButton(
                    this.textureRegistry,
                    COMPARATOR_LABELS[condition.comparator],
                    ACTIVE_ACCENT,
                    () => this._openDropdown(COMPARATOR_LABELS.map((label, value) => new DropdownOption(label, () => {
                        condition.comparator = value;
                        this._sendRules();
                    })), comparator),
                );
                row.leading(comparator);
                row.leading(this._buildValueInput(condition));
            }
            row.trailing(this._removeButton(() => {
                rule.conditions.splice(conditionIndex, 1);
                this._sendRules();
            }));
        });
    }

    /**
     * Whether the condition compares a number (stored totals, numeric device keys).
     * @private
     * @param {LogicCondition} condition
     * @returns {boolean}
     */
    _conditionIsNumeric(condition) {
        if (condition.kind === LOGIC_CONDITION_KIND_STORED) {
            return true;
        }
        return this._statedValueLabel(condition) === null;
    }

    /**
     * A condition's editor buttons, left to right.
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @param {LogicCondition} condition
     * @returns {Container[]}
     */
    _conditionButtons(snapshot, condition) {
        if (condition.kind === LOGIC_CONDITION_KIND_STORED) {
            return this._storedConditionButtons(snapshot, condition);
        }
        return this._deviceConditionButtons(snapshot, condition);
    }

    /**
     * Stored condition: an optional container icon (its type sprite), then the item icon; tapping
     * either opens its picker.
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @param {LogicCondition} condition
     * @returns {Container[]}
     */
    _storedConditionButtons(snapshot, condition) {
        const buttons = [];
        if (condition.deviceId !== 0) {
            const containers = this._pickerDevices(snapshot).filter(device => this._isContainer(device));
            const container = this._deviceById(snapshot, condition.deviceId);
            let containerTexture = LogicTerminalDefinition.textureName;
            if (container !== undefined) {
                containerTexture = container.type.textureName;
            }
            const containerButton = buildIconButton(this.textureRegistry, containerTexture, 0xffffff, ACTIVE_ACCENT,
                () => this._openDropdown(containers.map(device => new DropdownOption(device.label, () => {
                    condition.deviceId = device.objectId;
                    this._sendRules();
                })), containerButton));
            buttons.push(containerButton);
        }
        const item = this._modRegistry.items.definitionFor(condition.itemType);
        const itemButton = buildIconButton(this.textureRegistry, item.texture, item.tint, ACTIVE_ACCENT,
            () => this._openIconPicker(this._storableEntries(), condition.itemType, (itemType) => {
                condition.itemType = itemType;
                this._sendRules();
            }, itemButton));
        buttons.push(itemButton);
        return buttons;
    }

    /**
     * Stated device condition: the device icon (its type sprite, tap picks another), then the
     * state dropdown.
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @param {LogicCondition} condition
     * @returns {Container[]}
     */
    _deviceConditionButtons(snapshot, condition) {
        const buttons = [];
        const devices = this._devicesWithReadKey(snapshot, condition.key);
        const device = this._deviceById(snapshot, condition.deviceId);
        let deviceTexture = LogicTerminalDefinition.textureName;
        if (device !== undefined) {
            deviceTexture = device.type.textureName;
        }
        const deviceButton = buildIconButton(this.textureRegistry, deviceTexture, 0xffffff, ACTIVE_ACCENT,
            () => this._openDropdown(devices.map(held => new DropdownOption(held.label, () => {
                condition.deviceId = held.objectId;
                this._sendRules();
            })), deviceButton));
        buttons.push(deviceButton);
        const entry = this._modRegistry.logicKeyEntry(condition.key);
        if (entry.states === null) {
            buttons.push(panelText(entry.name, TextRole.MUTED));
            return buttons;
        }
        let stateLabel = this._statedValueLabel(condition);
        if (stateLabel === null) {
            stateLabel = "?";
        }
        const stateButton = buildPanelButton(this.textureRegistry, `${stateLabel} ▾`, ACTIVE_ACCENT,
            () => this._openDropdown(entry.states.map(state => new DropdownOption(state.state, () => {
                condition.comparator = LOGIC_COMPARATOR_EXACTLY;
                condition.value = state.value;
                this._sendRules();
            })), stateButton));
        buttons.push(stateButton);
        return buttons;
    }

    /**
     * The condition's number box; Enter or leaving the box commits and sends.
     * @private
     * @param {LogicCondition} condition
     * @returns {TextInput}
     */
    _buildValueInput(condition) {
        const input = new TextInput(this._app, VALUE_INPUT_WIDTH, ROW_HEIGHT, VALUE_INPUT_MAX_DIGITS, "", true);
        // An open dropdown covers the panel; the DOM box must not float through it.
        input.visible = this._dropdown === null;
        this._valueInputs.push(input);
        input.value = `${condition.value}`;
        const commit = (raw) => {
            const parsed = Number.parseInt(raw, 10);
            if (!Number.isInteger(parsed) || parsed < 0 || parsed === condition.value) {
                input.value = `${condition.value}`;
                return;
            }
            condition.value = parsed;
            this._sendRules();
        };
        input.onSubmit(commit);
        input.onBlur(commit);
        return input;
    }

    /**
     * @private
     * @param {function(): void} onClick
     * @returns {Container}
     */
    _removeButton(onClick) {
        return buildPanelButton(this.textureRegistry, "X", INACTIVE_TINT, onClick);
    }

    /**
     * The pop-up option list over the panel, when a dropdown is open.
     * @private
     * @returns {void}
     */
    _buildOverlay() {
        this._clearOverlay();
        if (this._dropdown === null) {
            return;
        }
        // An invisible full-screen catcher: tapping outside the list closes it (no dim).
        const catcher = new Container();
        catcher.eventMode = "static";
        catcher.hitArea = new Rectangle(0, 0, this._app.screen.width, this._app.screen.height);
        catcher.on("pointerdown", () => {
            this._dropdown = null;
            this._rebuild();
        });
        this.addChild(catcher);

        let list;
        let listHeight;
        if (this._dropdown.kind === "icons") {
            list = new IconPicker(this.textureRegistry, this.viewport, DROPDOWN_WIDTH,
                this._dropdown.entries, (id) => {
                    const onPick = this._dropdown.onPick;
                    this._dropdown = null;
                    onPick(id);
                    this._rebuild();
                }, {selectedId: this._dropdown.selectedId});
            listHeight = list.pickerHeight;
        } else {
            list = new PanelStack(this.textureRegistry, DROPDOWN_WIDTH);
            list.scrollSection(this.viewport, this._dropdown.options, (option) => ({
                label: option.label,
                onRowClick: () => {
                    this._dropdown = null;
                    option.pick();
                    this._rebuild();
                },
            }), "Nothing available.", {visibleRows: DROPDOWN_ROWS});
            listHeight = list.contentHeight;
        }
        const anchor = this._dropdownAnchor;
        list.x = Math.max(DROPDOWN_MARGIN,
            Math.min(anchor.x, this._app.screen.width - DROPDOWN_WIDTH - DROPDOWN_MARGIN));
        // Below the button; flipped above it when the list would leave the screen.
        list.y = anchor.bottom + DROPDOWN_GAP;
        if (list.y + listHeight > this._app.screen.height - DROPDOWN_MARGIN) {
            list.y = Math.max(DROPDOWN_MARGIN, anchor.top - DROPDOWN_GAP - listHeight);
        }
        list.eventMode = "static";
        this.addChild(list);
        this._overlay = [catcher, list];
    }

    /**
     * @private
     * @returns {void}
     */
    _clearOverlay() {
        if (this._overlay === null) {
            return;
        }
        for (const child of this._overlay) {
            child.destroy({children: true});
        }
        this._overlay = null;
    }

    /**
     * The verbs of the rule's own key ("Open"/"Close", "Enable"/"Disable"): one option per state
     * position. A rule whose target no longer holds the key falls back to another device holding
     * it, then to any switchable device (adopting its key).
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @param {LogicRule} rule
     * @returns {DropdownOption[]}
     */
    _actionVerbOptionsFor(snapshot, rule) {
        let key = rule.actionKey;
        let device = this._deviceById(snapshot, rule.actionDeviceId);
        if (device === undefined || !device.writeKeys.includes(key)) {
            const holders = this._devicesWithWriteKey(snapshot, key);
            if (holders.length > 0) {
                device = holders[0];
            } else {
                const targets = this._switchableDevices(snapshot);
                if (targets.length === 0) {
                    return [];
                }
                device = targets[0];
                key = this._statedWriteKey(device);
            }
        }
        return this._modRegistry.logicKeyEntry(key).states.map((state, stateIndex) =>
            new DropdownOption(state.verb, () => {
                this._applySwitch(rule, device, key, stateIndex);
                this._sendRules();
            }));
    }

    /**
     * The "Add action" verbs: each distinct stated write key among the network's devices, its
     * states in order ("Open", "Close", "Enable", "Disable"). Picking appends a rule on the first
     * device holding that key; the rule's own row retargets it from there.
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @returns {DropdownOption[]}
     */
    _addActionOptionsFor(snapshot) {
        const options = [];
        const seenKeys = [];
        for (const device of this._switchableDevices(snapshot)) {
            const key = this._statedWriteKey(device);
            if (seenKeys.includes(key)) {
                continue;
            }
            seenKeys.push(key);
            for (const [stateIndex, state] of this._modRegistry.logicKeyEntry(key).states.entries()) {
                options.push(new DropdownOption(state.verb, () => {
                    const appended = new LogicRule(device.objectId, 0, 0, []);
                    this._applySwitch(appended, device, key, stateIndex);
                    this._rules.push(appended);
                    this._sendRules();
                }));
            }
        }
        return options;
    }

    /**
     * Points the rule's action at `device`'s `key`, in the given state position.
     * @private
     * @param {LogicRule} rule
     * @param {PickerDevice} device
     * @param {number} key
     * @param {number} stateIndex - position in the key's states (0 = permissive)
     * @returns {void}
     */
    _applySwitch(rule, device, key, stateIndex) {
        rule.actionDeviceId = device.objectId;
        rule.actionKey = key;
        rule.actionValue = this._modRegistry.logicKeyEntry(key).states[stateIndex].value;
    }

    /**
     * The device's first stated writable key, or null when it has no switch.
     * @private
     * @param {PickerDevice} device
     * @returns {number|null}
     */
    _statedWriteKey(device) {
        for (const key of device.writeKeys) {
            if (this._modRegistry.logicKeyEntry(key).states !== null) {
                return key;
            }
        }
        return null;
    }

    /**
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @returns {PickerDevice[]}
     */
    _switchableDevices(snapshot) {
        return this._pickerDevices(snapshot).filter(device => this._statedWriteKey(device) !== null);
    }

    /**
     * The finite condition types: "Total Amount stored" (network sum), "Amount stored" (one
     * container), and one "<X> state" per stated readable key among the network's devices.
     * Picking appends a condition on its defaults; the row's own buttons edit it from there.
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @param {LogicRule} rule
     * @returns {DropdownOption[]}
     */
    _conditionTypeOptionsFor(snapshot, rule) {
        const options = [];
        const append = (condition) => {
            rule.conditions.push(condition);
            this._sendRules();
        };
        const storables = this._storableItems();
        const containers = this._pickerDevices(snapshot).filter(device => this._isContainer(device));
        if (storables.length > 0) {
            options.push(new DropdownOption("Total Amount stored", () => append(storedCondition(
                storables[0].itemType, LOGIC_COMPARATOR_AT_LEAST, DEFAULT_STORED_VALUE))));
            if (containers.length > 0) {
                options.push(new DropdownOption("Amount stored", () => append(storedCondition(
                    storables[0].itemType, LOGIC_COMPARATOR_AT_LEAST, DEFAULT_STORED_VALUE,
                    containers[0].objectId))));
            }
        }
        const statedKeys = [];
        for (const device of this._pickerDevices(snapshot)) {
            for (const key of device.readKeys) {
                if (this._modRegistry.logicKeyEntry(key).states !== null && !statedKeys.includes(key)) {
                    statedKeys.push(key);
                }
            }
        }
        for (const key of statedKeys) {
            const entry = this._modRegistry.logicKeyEntry(key);
            const devices = this._devicesWithReadKey(snapshot, key);
            options.push(new DropdownOption(entry.stateLabel, () => append(deviceCondition(
                devices[0].objectId, key, LOGIC_COMPARATOR_EXACTLY, entry.states[0].value))));
        }
        return options;
    }

    /**
     * Whether a device holds a stored total: it exposes a numeric readable key.
     * @private
     * @param {PickerDevice} device
     * @returns {boolean}
     */
    _isContainer(device) {
        return device.readKeys.some(key => this._modRegistry.logicKeyEntry(key).states === null);
    }

    /**
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @param {number} key
     * @returns {PickerDevice[]}
     */
    _devicesWithReadKey(snapshot, key) {
        return this._pickerDevices(snapshot).filter(device => device.readKeys.includes(key));
    }

    /**
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @param {number} key
     * @returns {PickerDevice[]}
     */
    _devicesWithWriteKey(snapshot, key) {
        return this._pickerDevices(snapshot).filter(device => device.writeKeys.includes(key));
    }

    /**
     * The storable item types, name-sorted. Tanks are the only storage, so only fluids qualify.
     * @private
     * @returns {StorableItem[]}
     */
    _storableItems() {
        const fluidTypes = this._modRegistry.fluidTypes;
        return [...this._modRegistry.items.entries()]
            .filter(([itemType]) => fluidTypes.has(itemType))
            .map(([itemType, definition]) => new StorableItem(itemType, definition))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * @private
     * @returns {IconPickerEntry[]}
     */
    _storableEntries() {
        return this._storableItems().map(item => new IconPickerEntry(item.itemType, item.texture, item.tint));
    }

    /**
     * The verb button's current label, e.g. "Close".
     * @private
     * @param {LogicRule} rule
     * @returns {string}
     */
    _actionVerb(rule) {
        const entry = this._modRegistry.logicKeyEntry(rule.actionKey);
        if (entry.states !== null) {
            const state = entry.states.find(held => held.value === rule.actionValue);
            if (state !== undefined) {
                return state.verb;
            }
        }
        return `Set ${entry.name} ${rule.actionValue}`;
    }

    /**
     * A stated device condition's phrase ("is open"), or null when the condition is numeric.
     * @private
     * @param {LogicCondition} condition
     * @returns {string|null}
     */
    _statedValueLabel(condition) {
        if (condition.kind === LOGIC_CONDITION_KIND_STORED || condition.comparator !== LOGIC_COMPARATOR_EXACTLY) {
            return null;
        }
        const entry = this._modRegistry.logicKeyEntry(condition.key);
        if (entry.states === null) {
            return null;
        }
        const state = entry.states.find(held => held.value === condition.value);
        if (state === undefined) {
            return null;
        }
        return state.state;
    }

    /**
     * The snapshot's devices as picker entries: per-type ordinals count up in the snapshot's
     * objectId order, so "Gate #2" stays stable while the network's membership holds.
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @returns {PickerDevice[]}
     */
    _pickerDevices(snapshot) {
        const countByType = new Map();
        return snapshot.deviceObjectIds.map((deviceObjectId, i) => {
            const typeId = snapshot.deviceTypeIds[i];
            const ordinal = (countByType.get(typeId) || 0) + 1;
            countByType.set(typeId, ordinal);
            return new PickerDevice(
                deviceObjectId,
                this._modRegistry.typeById(typeId),
                snapshot.deviceTileXs[i],
                snapshot.deviceTileYs[i],
                ordinal,
            );
        });
    }

    /**
     * @private
     * @param {LogicSnapshotEvent} snapshot
     * @param {number} deviceObjectId
     * @returns {PickerDevice|undefined}
     */
    _deviceById(snapshot, deviceObjectId) {
        return this._pickerDevices(snapshot).find(device => device.objectId === deviceObjectId);
    }

    /**
     * Glides the game viewport to a device's tile, keeping the panel open.
     * @private
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    _glideToDevice(tileX, tileY) {
        this.viewport.glideTo({
            x: tileX * TILE_SIZE + TILE_SIZE / 2,
            y: tileY * TILE_SIZE + TILE_SIZE / 2,
        });
    }
}

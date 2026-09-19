import {BINDABLE_KEYS, getBindableKeyValueByKeyOrNull} from "@/common/bindableKeys.js";

/**
 * One rebindable keyboard action: the player setting holding its key, and the key it holds while
 * that setting is unset. The stored value indexes {@link BINDABLE_KEYS}.
 */
export class KeybindingEntry {

    /**
     * @param {number} playerSettingKey
     * @param {string} label settings-menu text
     * @param {string} defaultKey
     */
    constructor(playerSettingKey, label, defaultKey) {
        const defaultValue = getBindableKeyValueByKeyOrNull(defaultKey);
        if (defaultValue === null) {
            throw new Error(`No bindable key "${defaultKey}"`);
        }
        this.playerSettingKey = playerSettingKey;
        this.label = label;
        this.defaultValue = defaultValue;
    }
}

export const KEYBINDING_PAN_UP = new KeybindingEntry(100, "Pan up", "w");
export const KEYBINDING_PAN_LEFT = new KeybindingEntry(101, "Pan left", "a");
export const KEYBINDING_PAN_DOWN = new KeybindingEntry(102, "Pan down", "s");
export const KEYBINDING_PAN_RIGHT = new KeybindingEntry(103, "Pan right", "d");
export const KEYBINDING_EXIT = new KeybindingEntry(104, "Back", "q");
export const KEYBINDING_CONFIRM = new KeybindingEntry(105, "Confirm", "Enter");
export const KEYBINDING_HOME = new KeybindingEntry(106, "Go home", "h");
export const KEYBINDING_PRODUCTION = new KeybindingEntry(107, "Production stats", "p");
export const KEYBINDING_CLAIM = new KeybindingEntry(108, "Chunk claims", "c");
export const KEYBINDING_DEBUG = new KeybindingEntry(109, "Debug mode", "F3");
export const KEYBINDING_ERASER = new KeybindingEntry(110, "Eraser", "e");
export const KEYBINDING_TICK = new KeybindingEntry(111, "Force a tick", "t");
export const KEYBINDING_DISCONNECT = new KeybindingEntry(112, "Drop the connection", "x");
export const KEYBINDING_DETAIL_OVERLAY = new KeybindingEntry(113, "Detailed overlay", "Alt");

// Player setting key of the first toolbar slot; the rest follow it in order.
const TOOL_SLOT_SETTING_KEY = 120;
const TOOL_SLOT_COUNT = 9;

/**
 * The toolbar slots, indexed by their position in the bar.
 * @type {KeybindingEntry[]}
 */
export const KEYBINDING_TOOL_SLOTS = Array.from({length: TOOL_SLOT_COUNT},
    (value, index) => new KeybindingEntry(TOOL_SLOT_SETTING_KEY + index, `Tool slot ${index + 1}`, String(index + 1)));

/**
 * Core rebindable actions; mods contribute theirs via their declaration's keybindingEntries.
 * @type {KeybindingEntry[]}
 */
export const CORE_KEYBINDING_ENTRIES = [
    KEYBINDING_PAN_UP,
    KEYBINDING_PAN_LEFT,
    KEYBINDING_PAN_DOWN,
    KEYBINDING_PAN_RIGHT,
    KEYBINDING_EXIT,
    KEYBINDING_CONFIRM,
    KEYBINDING_HOME,
    KEYBINDING_PRODUCTION,
    KEYBINDING_CLAIM,
    KEYBINDING_DEBUG,
    KEYBINDING_ERASER,
    KEYBINDING_TICK,
    KEYBINDING_DISCONNECT,
    KEYBINDING_DETAIL_OVERLAY,
].concat(KEYBINDING_TOOL_SLOTS);

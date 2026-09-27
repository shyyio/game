/**
 * The key names a keybinding may hold (a KeyboardEvent.key, or one prefixed "Ctrl+"), in the order
 * their stored values index them. Index 0 is the empty key: the binding is unbound and fires nothing.
 */
export const BINDABLE_KEYS = [
    "",
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
    "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Enter", "Escape", " ", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`",
    "Alt",
    "Ctrl+a", "Ctrl+b", "Ctrl+c", "Ctrl+d", "Ctrl+e", "Ctrl+f", "Ctrl+g", "Ctrl+h", "Ctrl+i", "Ctrl+j",
    "Ctrl+k", "Ctrl+l", "Ctrl+m", "Ctrl+n", "Ctrl+o", "Ctrl+p", "Ctrl+q", "Ctrl+r", "Ctrl+s", "Ctrl+t",
    "Ctrl+u", "Ctrl+v", "Ctrl+w", "Ctrl+x", "Ctrl+y", "Ctrl+z",
];

// The KeyboardEvent.key values that are themselves the Ctrl modifier.
const CTRL_KEYS = new Set(["Control", "Meta"]);

/**
 * The bindable name a key event fires: its key, prefixed "Ctrl+" while Ctrl or Meta is held.
 * @param {KeyboardEvent} event
 * @returns {string}
 */
export function getKeyNameByEvent(event) {
    if ((event.ctrlKey || event.metaKey) && !CTRL_KEYS.has(event.key)) {
        return `Ctrl+${event.key}`;
    }
    return event.key;
}

// The stored value of a binding no key fires.
export const BINDABLE_KEY_UNBOUND = 0;

/**
 * @param {number} value
 * @returns {string} the empty string when unbound
 */
export function getBindableKeyByValue(value) {
    const key = BINDABLE_KEYS[value];
    if (key === undefined) {
        throw new Error(`No bindable key ${value}`);
    }
    return key;
}

/**
 * @param {string} key
 * @returns {number|null} null for a key no binding may hold
 */
export function getBindableKeyValueByKeyOrNull(key) {
    const value = BINDABLE_KEYS.indexOf(key);
    if (value === -1) {
        return null;
    }
    return value;
}

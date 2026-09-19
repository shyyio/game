/**
 * The KeyboardEvent.key values a keybinding may hold, in the order their stored values index
 * them. Index 0 is the empty key: the binding is unbound and fires nothing.
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
];

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

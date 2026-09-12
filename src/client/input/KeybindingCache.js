import Keyboard from "@/client/input/Keyboard.js";
import {ListenerList} from "@/common/ListenerList.js";
import {getBindableKeyByValue, getBindableKeyValueByKeyOrNull, BINDABLE_KEY_UNBOUND} from "@/common/bindableKeys.js";

/**
 * The key each rebindable action currently fires on, and the Keyboard subscriptions behind it.
 */
export class KeybindingCache {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        /**
         * @type {Map<KeybindingEntry, Function[]>}
         * @private
         */
        this._callbacks = new Map();
        /**
         * The key each entry fires on right now; its callbacks are registered under it.
         * @type {Map<KeybindingEntry, string>}
         * @private
         */
        this._keys = new Map();
        this._changeListeners = new ListenerList();
        for (const entry of client.modRegistry.keybindingEntries) {
            this._callbacks.set(entry, []);
            this._keys.set(entry, getBindableKeyByValue(this.getValueByEntry(entry)));
        }
        client.cache.subscribe("playerSettings.values", key => this._onSettingWritten(key));
    }

    /**
     * @param {KeybindingEntry} entry
     * @returns {string} the empty string while unbound
     */
    getKeyByEntry(entry) {
        return this._keys.get(entry);
    }

    /**
     * @param {KeybindingEntry} entry
     * @returns {number} the entry's default while the setting is unset
     */
    getValueByEntry(entry) {
        const value = this._client.cache.view("playerSettings").getValueByKey(entry.playerSettingKey);
        if (value === undefined) {
            return entry.defaultValue;
        }
        return value;
    }

    /**
     * @param {KeybindingEntry} entry
     * @returns {boolean} false while unbound
     */
    isKeyDownByEntry(entry) {
        return Keyboard.isKeyDown(this._keys.get(entry));
    }

    /**
     * Binds a callback to an action, following it across rebinds.
     * @param {KeybindingEntry} entry
     * @param {keyboardCallback} callback
     * @returns {void}
     */
    on(entry, callback) {
        this._callbacks.get(entry).push(callback);
        Keyboard.on(this._keys.get(entry), callback);
    }

    /**
     * @param {KeybindingEntry} entry
     * @param {keyboardCallback} callback
     * @returns {void}
     */
    off(entry, callback) {
        const callbacks = this._callbacks.get(entry);
        callbacks.splice(callbacks.indexOf(callback), 1);
        Keyboard.off(this._keys.get(entry), callback);
    }

    /**
     * Writes an action's key, unbinding whichever action holds it today.
     * @param {KeybindingEntry} entry
     * @param {string} key the empty string unbinds
     * @returns {void}
     */
    setKeyByEntry(entry, key) {
        const value = getBindableKeyValueByKeyOrNull(key);
        if (value === null) {
            throw new Error(`No bindable key "${key}"`);
        }
        if (value !== BINDABLE_KEY_UNBOUND) {
            for (const other of this._keys.keys()) {
                if (other !== entry && this._keys.get(other) === key) {
                    this._client.setPlayerSetting(other.playerSettingKey, BINDABLE_KEY_UNBOUND);
                }
            }
        }
        this._client.setPlayerSetting(entry.playerSettingKey, value);
    }

    /**
     * Registers a listener fired after any binding changes, for the HUD's key hints.
     * @param {function(): void} listener
     * @returns {function(): void} unsubscribe
     */
    notifyChange(listener) {
        return this._changeListeners.add(listener);
    }

    /**
     * Re-registers the written action's callbacks under its new key.
     * @private
     * @param {number} playerSettingKey
     * @returns {void}
     */
    _onSettingWritten(playerSettingKey) {
        const entry = this._client.modRegistry.getKeybindingEntryByPlayerSettingKeyOrNull(playerSettingKey);
        if (entry === null) {
            return;
        }
        const key = getBindableKeyByValue(this.getValueByEntry(entry));
        const boundKey = this._keys.get(entry);
        if (boundKey === key) {
            return;
        }
        for (const callback of this._callbacks.get(entry)) {
            Keyboard.off(boundKey, callback);
            Keyboard.on(key, callback);
        }
        this._keys.set(entry, key);
        this._changeListeners.notify();
    }
}

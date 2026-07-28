import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap} from "@/client/ClientCache.js";

export const PLAYER_SETTINGS_SCHEMA = {
    values: schemaMap(),
};

export const GAME_SETTINGS_SCHEMA = {
    values: schemaMap(),
};

/**
 * Writes the per-player settings mirror from its sync and update events.
 */
export class PlayerSettingsWriter extends AbstractCacheWriter {

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof PlayerSettingsSyncEvent) {
            for (const [key, value] of Object.entries(event.values)) {
                this._state.mapSet("playerSettings.values", Number(key), value);
            }
        }
        if (event instanceof PlayerSettingsUpdateEvent) {
            this._state.mapSet("playerSettings.values", event.key, event.value);
        }
    }

    /**
     * Local (optimistic) write, so the echoed server update is a no-op.
     * @param {number} key
     * @param {number} value
     * @returns {void}
     */
    set(key, value) {
        this._state.mapSet("playerSettings.values", key, value);
    }
}

/**
 * Derived reads over the playerSettings namespace.
 */
export class PlayerSettingsView extends AbstractCacheView {

    /**
     * @param {number} key
     * @returns {number|undefined} undefined until a value arrives
     */
    get(key) {
        return this._state.mapGet("playerSettings.values", key);
    }
}

/**
 * Derived reads over the gameSettings namespace.
 */
export class GameSettingsView extends AbstractCacheView {

    /**
     * @param {number} key
     * @returns {number|undefined} undefined until a value arrives
     */
    get(key) {
        return this._state.mapGet("gameSettings.values", key);
    }
}

/**
 * Writes the shared game-settings mirror from its sync and update events.
 */
export class GameSettingsWriter extends AbstractCacheWriter {

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof GameSettingsSyncEvent) {
            for (const [key, value] of Object.entries(event.values)) {
                this._state.mapSet("gameSettings.values", Number(key), value);
            }
        }
        if (event instanceof GameSettingsUpdateEvent) {
            this._state.mapSet("gameSettings.values", event.key, event.value);
        }
    }
}

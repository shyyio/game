import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {PlayerSettingsToolOrderSyncEvent} from "@/common/PlayerSettingsToolOrderEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap, schemaScalar} from "@/client/ClientCache.js";

export const PLAYER_SETTINGS_SCHEMA = {
    values: schemaMap(),
    toolOrder: schemaScalar([]),
};

/**
 * Whether two tool-order arrays hold the same ids in the same positions.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean}
 */
function sameToolOrder(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

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
        if (event instanceof PlayerSettingsToolOrderSyncEvent) {
            // ClientCache.set dedupes by reference, which never matches a decoded array; compare
            // contents so the echo of a just-applied local reorder doesn't rebuild the toolbar again.
            if (!sameToolOrder(this._state.get("playerSettings.toolOrder"), event.toolIds)) {
                this._state.set("playerSettings.toolOrder", event.toolIds);
            }
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

    /**
     * Local (optimistic) write of the whole custom toolbar order, so the echoed server update is
     * a no-op.
     * @param {number[]} toolIds
     * @returns {void}
     */
    setToolOrder(toolIds) {
        this._state.set("playerSettings.toolOrder", toolIds);
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

    /**
     * @returns {number[]} the player's custom toolbar order (tool ids), empty until synced
     */
    toolOrder() {
        return this._state.get("playerSettings.toolOrder");
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

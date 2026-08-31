import {ViewMode, MAP_MODE_SCALE_THRESHOLD, OVERWORLD_SCALE_THRESHOLD} from "@/client/constants.js";

/**
 * Which of the three zoom bands the viewport sits in, and the fan-out that happens when it crosses
 * into another one.
 */
export class ViewModeController {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        this._current = ViewMode.WORLD;
        this._onChange = null;
    }

    /**
     * @returns {ViewMode}
     */
    get current() {
        return this._current;
    }

    /**
     * Registers the handler invoked when the zoom-driven view mode changes.
     * @param {function(mode: ViewMode)} callback
     * @returns {void}
     */
    onChange(callback) {
        this._onChange = callback;
    }

    /**
     * Switches the view mode when the viewport scale crosses {@link MAP_MODE_SCALE_THRESHOLD}
     * or {@link OVERWORLD_SCALE_THRESHOLD}, transitioning the data feeds with it.
     * @returns {void}
     */
    update() {
        const scale = this._client.viewport.scale.x;
        let mode;
        if (scale < OVERWORLD_SCALE_THRESHOLD) {
            mode = ViewMode.OVERWORLD;
        } else if (scale < MAP_MODE_SCALE_THRESHOLD) {
            mode = ViewMode.MAP;
        } else {
            mode = ViewMode.WORLD;
        }
        if (mode === this._current) {
            return;
        }
        const previous = this._current;
        this._current = mode;
        this._client.drawLayerRegistry.setViewMode(mode);
        this._client.hud.mapButtonsLayer.setViewMode(mode);
        this._client.hud.friendsPanelLayer.setViewMode(mode);
        this._client.hud.refreshToolbarVisibility();
        for (const mod of this._client.modRegistry.clientMods) {
            mod.setViewMode(mode, this._client);
        }
        if (this._onChange != null) {
            this._onChange(mode);
        }
        this._client.claimSelection.onViewMode(previous);
        this._client.settleFlow.onViewMode(previous);
        if (mode === ViewMode.OVERWORLD) {
            this._client.subscription.enterOverworld();
        } else if (previous === ViewMode.OVERWORLD) {
            this._client.subscription.leaveOverworld();
        }
    }

}

import {AbstractClientMod, Mouse, SettingCategory, PlayerSettingChoice, WindowFocus} from "@/sdk/client.js";
import {CURSOR_SETTING_SHARE, CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_OPTIONS, CURSOR_AUDIENCE_DEFAULT} from "./common/constants.js";
import {REMOTE_CURSORS_SCHEMA, RemoteCursorsWriter} from "./client/RemoteCursorsState.js";
import {RemoteCursorsDrawLayer} from "./client/RemoteCursorsDrawLayer.js";
import {CursorPublisher} from "./client/CursorPublisher.js";

export class CursorSyncClientMod extends AbstractClientMod {

    constructor() {
        super();
        this._layer = null;
        this._publisher = null;
    }

    /**
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {
        client.cache.register("remoteCursors", REMOTE_CURSORS_SCHEMA, new RemoteCursorsWriter(client.cache));
        this._layer = new RemoteCursorsDrawLayer(client.cache);
        this._publisher = new CursorPublisher(client.session, Mouse, client.cache, WindowFocus);
    }

    /**
     * @param {Client} client
     * @returns {AbstractDrawLayer[]}
     */
    drawLayers(client) {
        return [this._layer];
    }

    /**
     * @param {Client} client
     * @returns {SettingCategory[]}
     */
    settingsCategories(client) {
        return [
            new SettingCategory("Cursor Sync", 10, [
                new PlayerSettingChoice(CURSOR_SETTING_SHARE, "Share my cursor with", CURSOR_AUDIENCE_OPTIONS, CURSOR_AUDIENCE_DEFAULT),
                new PlayerSettingChoice(CURSOR_SETTING_DISPLAY, "Display cursors from", CURSOR_AUDIENCE_OPTIONS, CURSOR_AUDIENCE_DEFAULT),
            ]),
        ];
    }

    /**
     * @param {ViewMode} mode
     * @param {Client} client
     * @returns {void}
     */
    setViewMode(mode, client) {
        this._publisher.setViewMode(mode);
    }

    /**
     * Starts the heartbeat once the session is live.
     * @param {Client} client
     * @returns {void}
     */
    onReady(client) {
        this._publisher.start();
    }
}

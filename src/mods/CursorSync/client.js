import {AbstractClientMod, Mouse, WindowFocus} from "@/sdk/client.js";
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

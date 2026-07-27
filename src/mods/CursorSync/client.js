import {AbstractClientMod, Mouse, WindowFocus} from "@/sdk/client.js";
import {RemoteCursorsCache} from "./client/RemoteCursorsCache.js";
import {RemoteCursorsDrawLayer} from "./client/RemoteCursorsDrawLayer.js";
import {CursorPublisher} from "./client/CursorPublisher.js";

export class CursorSyncClientMod extends AbstractClientMod {

    constructor() {
        super();
        this._cache = null;
        this._layer = null;
        this._publisher = null;
    }

    /**
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {
        this._cache = new RemoteCursorsCache(client.chunkClaimsCache, client.playerSettings);
        this._layer = new RemoteCursorsDrawLayer(this._cache, client.chunkClaimsCache);
        this._publisher = new CursorPublisher(client.session, Mouse, client.playerSettings, WindowFocus);
    }

    /**
     * @param {Client} client
     * @returns {AbstractDrawLayer[]}
     */
    drawLayers(client) {
        return [this._layer];
    }

    /**
     * @param {AbstractEvent} event
     * @param {Client} client
     * @returns {void}
     */
    onEvent(event, client) {
        this._cache.onEvent(event);
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

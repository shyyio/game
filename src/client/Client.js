import {TextureRegistry} from "@/client/TextureRegistry.js";
import {DrawLayerRegistry} from "@/client/DrawLayerRegistry.js";
import {PlayerSettings} from "@/client/PlayerSettings.js";
import {GameSettings} from "@/client/GameSettings.js";
import {MiniMenuLayer} from "@/client/MiniMenuLayer.js";
import {DirectionWheelLayer} from "@/client/DirectionWheelLayer.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {ChunkSyncEvent} from "@/common/CoreEvents.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {TILE_SIZE, snapToChunk} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkKey} from "@/common/util.js";
import {GridDrawLayer} from "@/client/GridDrawLayer.js";
import {MaskDrawLayer} from "@/client/MaskDrawLayer.js";

export const CoreDrawLayers = [
    new GridDrawLayer(),
    new MaskDrawLayer(),
];

export class Client {

    /**
     * @param {Application} app
     * @param {ClientViewport} viewport
     * @param {AbstractSession} session
     * @param {ModRegistry} modRegistry
     */
    constructor(app, viewport, session, modRegistry) {
        this.app = app;
        this.viewport = viewport;
        this.session = session;
        this.modRegistry = modRegistry;

        this.textureRegistry = new TextureRegistry();
        this.drawLayerRegistry = new DrawLayerRegistry(modRegistry);
        this.playerSettings = new PlayerSettings();
        this.gameSettings = new GameSettings();
        this.miniMenuLayer = new MiniMenuLayer();
        this.directionWheelLayer = new DirectionWheelLayer(viewport);

        CoreDrawLayers.forEach(layer => {
            this.drawLayerRegistry.add(layer);
        });

        this._lastViewportKey = null;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        await this.textureRegistry.loadFromModRegistry(this.modRegistry);

        this.drawLayerRegistry.layers.forEach(layer => {
            layer.textureRegistry = this.textureRegistry;
            this.viewport.addChild(layer);
        });

        this.app.stage.addChild(this.miniMenuLayer);
        this.app.stage.addChild(this.directionWheelLayer);

        this.viewport.on("moved", () => this._updateViewportChunks());
        this.viewport.on("zoomed", () => this._updateViewportChunks());
        this._updateViewportChunks();
    }

    /**
     * @private
     */
    _visibleChunks() {
        const x1 = this.viewport.left / TILE_SIZE;
        const y1 = this.viewport.top / TILE_SIZE;
        const x2 = this.viewport.right / TILE_SIZE;
        const y2 = this.viewport.bottom / TILE_SIZE;

        const chunks = [];
        for (let x = snapToChunk(x1) - CHUNK_SIZE; x <= snapToChunk(x2); x += CHUNK_SIZE) {
            for (let y = snapToChunk(y1) - CHUNK_SIZE; y <= snapToChunk(y2); y += CHUNK_SIZE) {
                chunks.push(chunkKey(x, y));
            }
        }
        return chunks;
    }

    /**
     * @private
     */
    _updateViewportChunks() {
        const chunks = this._visibleChunks();
        const key = chunks.slice().sort().join(";");
        if (key === this._lastViewportKey) {
            return;
        }
        this._lastViewportKey = key;
        this.sendMessage(new SetViewportMessage(chunks));
    }

    /**
     * @param {AbstractMessage} message
     */
    sendMessage(message) {
        this.session.sendMessage(message);
    }

    /**
     * @param {AbstractEvent} event
     */
    publishEvent(event) {
        if (event instanceof ChunkSyncEvent) {
            // A chunk-seed bundle: replay each inner event through the normal path.
            // Seed events are distinct types (e.g. BeltSyncEvent vs BeltInsertEvent),
            // so handlers can already tell a load from a live change.
            event.events.forEach(inner => this.publishEvent(inner));
            return;
        }
        if (event instanceof PlayerSettingsSyncEvent) {
            Object.entries(event.values).forEach(([key, value]) => {
                this.playerSettings.update(Number(key), value);
            });
            return;
        }
        if (event instanceof PlayerSettingsUpdateEvent) {
            this.playerSettings.update(event.key, event.value);
            return;
        }
        if (event instanceof GameSettingsSyncEvent) {
            Object.entries(event.values).forEach(([key, value]) => {
                this.gameSettings.update(Number(key), value);
            });
            return;
        }
        if (event instanceof GameSettingsUpdateEvent) {
            this.gameSettings.update(event.key, event.value);
            return;
        }
        this.modRegistry.handleClientEvent(event, this);
        this.drawLayerRegistry.publishEvent(event);
    }
}

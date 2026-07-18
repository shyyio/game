import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {MAP_TILE_COLOR} from "@/client/Theme.js";
import {ObjectClientData} from "@/client/ClientCacheSync.js";
import {ObjectSprite} from "@/client/ObjectSprite.js";

/**
 * Renders one object type's placed sprites off the shared cache: ClientCacheSync owns the entries,
 * this layer mirrors them (a pure renderer — it never writes the cache). Bespoke rendering (belts)
 * hand-rolls a layer instead.
 */
export class ObjectDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ObjectType} type
     */
    constructor(type) {
        super();
        this._type = type;
        this._objects = {};
        this._mapModeObjects = {};
        this._mapMode = false;
    }

    get layerIndex() {
        return 20;
    }

    /**
     * Subscribes to the shared cache; the client calls this once when it builds the type's bundle.
     * @param {ClientCache} cache
     * @returns {void}
     */
    bindCache(cache) {
        cache.onSet(entry => this._onSet(entry));
        cache.onRemove(entry => this.removeObject(entry.id));
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        // No-op: a pure renderer, driven by cache listeners.
    }

    /**
     * @private
     * @param {CacheEntry} entry
     * @returns {void}
     */
    _onSet(entry) {
        if (!(entry.data instanceof ObjectClientData) || entry.data.type.typeId !== this._type.typeId) {
            return;
        }
        this.removeObject(entry.id);
        this.addObject(entry.id, new ObjectSprite(
            entry.id,
            entry.tileX,
            entry.tileY,
            entry.data.direction,
            this.textureRegistry.get(this._type.textureName),
            this._type,
        ));
    }

    /**
     * Toggles map mode by swapping each object's full sprite for its persistent
     * map-mode rectangle (both are kept loaded, so this is just a visibility flip).
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
        for (const sprite of Object.values(this._objects)) {
            sprite.visible = !value;
        }
        for (const sprite of Object.values(this._mapModeObjects)) {
            sprite.visible = value;
        }
    }

    /**
     * Builds the persistent map-mode rectangle shown for an object in map mode, spanning its whole
     * geometry (one tile per geometry cell).
     * @param {Sprite} sprite
     * @returns {Graphics}
     * @private
     */
    _createMapModeObject(sprite) {
        const mapModeSprite = new Graphics();
        for (const cell of this._type.geometry.tiles(sprite.direction)) {
            mapModeSprite.rect(
                (sprite.tileX + cell.x) * TILE_SIZE,
                (sprite.tileY + cell.y) * TILE_SIZE,
                TILE_SIZE,
                TILE_SIZE,
            );
        }
        mapModeSprite.fill(MAP_TILE_COLOR);
        mapModeSprite.visible = this._mapMode;
        return mapModeSprite;
    }

    /**
     * @param {number} id
     * @param {Sprite} sprite
     */
    addObject(id, sprite) {
        this._objects[id] = sprite;
        this.addChild(sprite);
        sprite.visible = !this._mapMode;

        const mapModeSprite = this._createMapModeObject(sprite);
        this._mapModeObjects[id] = mapModeSprite;
        this.addChild(mapModeSprite);
    }

    /**
     * @param {number} id
     */
    removeObject(id) {
        const sprite = this._objects[id];

        if (sprite === undefined) {
            return;
        }

        sprite.destroy();
        this.removeChild(sprite);
        delete this._objects[id];

        const mapModeSprite = this._mapModeObjects[id];
        if (mapModeSprite !== undefined) {
            mapModeSprite.destroy();
            this.removeChild(mapModeSprite);
            delete this._mapModeObjects[id];
        }
    }

    /**
     * Advances every object sprite to the shared animation frame (skipped in map mode).
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        if (this._mapMode) {
            return;
        }
        for (const sprite of Object.values(this._objects)) {
            sprite.tick(frame);
        }
    }
}

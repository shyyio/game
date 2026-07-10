import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {MAP_TILE_COLOR} from "@/client/Theme.js";
import {ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {EasySprite} from "@/client/EasySprite.js";

/**
 * Owns a placed object type's full client lifecycle off the generic events (cache + sprite + chunk
 * teardown). A mod composes one per object type; bespoke rendering (belts) hand-rolls a layer.
 */
export class EasyObjectDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ObjectDefinition} definition - the object type this layer renders (its typeId matches
     *     incoming events; its reference is the cache identity)
     */
    constructor(definition) {
        super();
        this._definition = definition;
        // Rendered out-port names, in event.portIds order — zipped back to a name map for the cache.
        this._renderedPortNames = definition.outputPorts.filter(port => port.render).map(port => port.name);
        this._objects = {};
        this._mapModeObjects = {};
        this._mapMode = false;
    }

    get layerIndex() {
        return 20;
    }

    /**
     * Toggles map mode by swapping each object's full sprite for its persistent
     * map-mode rectangle (both are kept loaded, so this is just a visibility flip).
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
        Object.values(this._objects).forEach(sprite => {
            sprite.visible = !value;
        });
        Object.values(this._mapModeObjects).forEach(sprite => {
            sprite.visible = value;
        });
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
        this._definition.geometry.tiles(sprite.direction).forEach(cell => {
            mapModeSprite.rect(
                (sprite.tileX + cell.x) * TILE_SIZE,
                (sprite.tileY + cell.y) * TILE_SIZE,
                TILE_SIZE,
                TILE_SIZE,
            );
        });
        mapModeSprite.fill(MAP_TILE_COLOR);
        mapModeSprite.visible = this._mapMode;
        return mapModeSprite;
    }

    /**
     * Insert/sync → cache + sprite; delete → drop both; chunk-unsubscribe → drop the ones this layer
     * owns (and only those, so mods don't clobber each other).
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof ChunkUnsubscribeEvent) {
            this.cache.getByChunk(event.chunk).forEach(entry => {
                if (this._objects[entry.id] !== undefined) {
                    this.removeObject(entry.id);
                    this.cache.remove(entry.id);
                }
            });
            return;
        }
        const placed = this._objectFor(event);
        if (placed !== null) {
            this.cache.set(placed.id, placed.tileX, placed.tileY, placed.cells, placed.ports, placed.data);
            this.addObject(placed.id, placed.sprite);
            return;
        }
        const removedId = this._removedId(event);
        if (removedId !== null) {
            this.removeObject(removedId);
            this.cache.remove(removedId);
        }
    }

    /**
     * The cache entry + sprite for an insert/sync event of this layer's object type, or null.
     * @param {AbstractEvent} event
     * @returns {{id: BigInt, tileX: number, tileY: number, cells: object[], ports: object, data: object, sprite: Sprite}|null}
     * @private
     */
    _objectFor(event) {
        const placed = event instanceof EasyObjectInsertEvent || event instanceof EasyObjectSyncEvent;
        if (!placed || event.typeId !== this._definition.typeId) {
            return null;
        }
        const ports = {};
        this._renderedPortNames.forEach((name, i) => {
            ports[name] = event.portIds[i];
        });
        return {
            id: event.id,
            tileX: event.x,
            tileY: event.y,
            cells: this._definition.geometry.tiles(event.direction).map(cell => ({
                x: event.x + cell.x,
                y: event.y + cell.y,
                layer: this._definition.occupancyLayer,
            })),
            ports,
            data: {definition: this._definition, direction: event.direction},
            sprite: new EasySprite(
                event.id,
                event.x,
                event.y,
                event.direction,
                this.textureRegistry.get(this._definition.textureName),
                this._definition,
            ),
        };
    }

    /**
     * The object id of a delete event of this layer's object type, or null.
     * @param {AbstractEvent} event
     * @returns {BigInt|null}
     * @private
     */
    _removedId(event) {
        return event instanceof EasyObjectDeleteEvent && event.typeId === this._definition.typeId ? event.id : null;
    }

    /**
     * @param {BigInt} id
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
     * @param {BigInt} id
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
        Object.values(this._objects).forEach(sprite => {
            sprite.tick(frame);
        });
    }
}

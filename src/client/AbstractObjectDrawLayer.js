import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";

const MAP_TILE_COLOR = 0x888888;

/**
 * Base AbstractDrawLayer for machine-type game objects.
 * Mods extend this and provide their own sprite constructors.
 */
export class AbstractObjectDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._objects = {};
        this._lowResObjects = {};
        this._lowRes = false;
    }

    get layerIndex() {
        return 20;
    }

    /**
     * Toggles map mode by swapping each object's full sprite for its persistent
     * low-res rectangle (both are kept loaded, so this is just a visibility flip).
     * @param {boolean} value
     */
    set lowRes(value) {
        this._lowRes = value;
        Object.values(this._objects).forEach(sprite => {
            sprite.visible = !value;
        });
        Object.values(this._lowResObjects).forEach(sprite => {
            sprite.visible = value;
        });
    }

    /**
     * Builds the persistent low-res rectangle shown for an object in map mode,
     * positioned over its tile.
     * @param {ObjectSprite} sprite
     * @returns {Graphics}
     * @private
     */
    _createLowResObject(sprite) {
        const lowResSprite = new Graphics();
        lowResSprite
            .rect(sprite.tileX * TILE_SIZE, sprite.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE)
            .fill(MAP_TILE_COLOR);
        lowResSprite.visible = this._lowRes;
        return lowResSprite;
    }

    onEvent(event) {
        // TODO: handle object insert/update/delete events
    }

    /**
     * @param {BigInt} id
     * @param {ObjectSprite} sprite
     */
    addObject(id, sprite) {
        this._objects[id] = sprite;
        this.addChild(sprite);
        sprite.visible = !this._lowRes;

        const lowResSprite = this._createLowResObject(sprite);
        this._lowResObjects[id] = lowResSprite;
        this.addChild(lowResSprite);
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

        const lowResSprite = this._lowResObjects[id];
        if (lowResSprite !== undefined) {
            lowResSprite.destroy();
            this.removeChild(lowResSprite);
            delete this._lowResObjects[id];
        }
    }

    tick(ticker) {
        Object.values(this._objects).forEach(sprite => {
            sprite.tick(ticker);
        });
    }
}

import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";

/**
 * Base AbstractDrawLayer for machine-type game objects.
 * Mods extend this and provide their own sprite constructors.
 */
export class AbstractObjectDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._objects = {};
    }

    get layerIndex() {
        return 20;
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
    }

    tick(ticker) {
        Object.values(this._objects).forEach(sprite => {
            sprite.tick(ticker);
        });
    }
}

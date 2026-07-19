import {Container} from "pixi.js";

/**
 * One chunk's renderables in a draw layer: the sprites, the optional pooled map-mode geometry, and
 * the root mounted into the layer.
 *
 * Layers group children this way because pixi's removeChild is a linear scan of the parent's
 * children: mounting a chunk root costs one scan of the mounted-chunk list, where mounting each
 * sprite would cost one scan of every sprite in the layer.
 */
export class ChunkNode {

    constructor() {
        this.root = new Container();
        this.sprites = new Container();
        /**
         * @type {Graphics|null}
         */
        this.graphics = null;
    }

    /**
     * @returns {Sprite[]} the chunk's sprites
     */
    get spriteList() {
        return this.sprites.children;
    }

    /**
     * @returns {boolean}
     */
    get isEmpty() {
        return this.sprites.children.length === 0;
    }

    /**
     * Hangs the sprites under the root, detaching any map geometry.
     * @returns {void}
     */
    showSprites() {
        if (this.graphics !== null) {
            this.root.removeChild(this.graphics);
        }
        this.root.addChild(this.sprites);
    }

    /**
     * Hangs `graphics` under the root, detaching the sprites.
     * @param {Graphics} graphics
     * @returns {void}
     */
    showGraphics(graphics) {
        this.root.removeChild(this.sprites);
        this.root.addChild(graphics);
    }

    /**
     * @returns {void}
     */
    destroy() {
        this.root.destroy({children: true});
        if (this.graphics !== null) {
            this.graphics.destroy();
        }
        this.sprites.destroy({children: true});
    }
}

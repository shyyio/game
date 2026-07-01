import {Container} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {EasySprite} from "@/client/EasySprite.js";
import {TILE_SIZE, GHOST_TINT, GHOST_ALPHA, GHOST_BLOCKED_TINT, GHOST_BLOCKED_ALPHA} from "@/client/constants.js";

/**
 * Placement-preview ghost: one tinted EasySprite at the hovered tile, pinned to screen center in
 * center-lock. The per-tile geometry feedback (red/blue/green) is the PlacementFeedbackLayer's job.
 * Driven by EasyObjectTool; Belt's multi-sprite ghost is bespoke.
 */
export class EasyObjectGhostLayer extends AbstractDrawLayer {

    /**
     * @param {ObjectDefinition} definition - the object type previewed (its geometry centers the sprite)
     */
    constructor(definition) {
        super();
        this._definition = definition;
        this._sprite = null;
        // Holds the sprite so center-lock can offset it to screen center.
        this._spriteContainer = new Container();
        this.addChild(this._spriteContainer);
        this._centerLock = false;
        this._anchorTileX = null;
        this._anchorTileY = null;
    }

    get layerIndex() {
        return 200;
    }

    onEvent(event) {
        // No-op: the ghost reacts to tool hover, not to game events.
    }

    /**
     * Shows a single ghost at the tile facing `direction`, tinted red when blocked.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {boolean} [blocked]
     */
    showGhost(tileX, tileY, direction, blocked=false) {
        this.clear();
        this._anchorTileX = tileX;
        this._anchorTileY = tileY;
        const sprite = new EasySprite(0n, tileX, tileY, direction, this.textureRegistry.require(this._definition.textureName), this._definition);
        sprite.setGhost(blocked ? GHOST_BLOCKED_TINT : GHOST_TINT, blocked ? GHOST_BLOCKED_ALPHA : GHOST_ALPHA);
        this._sprite = sprite;
        this._spriteContainer.addChild(sprite);
        this._updateCenterPin();
    }

    clear() {
        if (this._sprite !== null) {
            this._sprite.destroy();
            this._spriteContainer.removeChild(this._sprite);
            this._sprite = null;
        }
        this._anchorTileX = null;
        this._anchorTileY = null;
    }

    /**
     * Toggles center-lock presentation: pin the ghost to screen center.
     * @param {boolean} enabled
     */
    setCenterLock(enabled) {
        this._centerLock = enabled;
        this._updateCenterPin();
    }

    /**
     * In center-lock, re-pins the ghost to screen center each frame so it stays fixed while panning.
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        this._updateCenterPin();
    }

    /**
     * Offsets the sprite container each frame so the anchor tile renders at the screen center.
     * @private
     */
    _updateCenterPin() {
        if (!this._centerLock || this._anchorTileX === null || this.viewport === null) {
            this._spriteContainer.position.set(0, 0);
            return;
        }
        const center = this.viewport.toWorld(
            this.viewport.screenWidth / 2,
            this.viewport.screenHeight / 2,
        );
        const anchorX = this._anchorTileX * TILE_SIZE + TILE_SIZE / 2;
        const anchorY = this._anchorTileY * TILE_SIZE + TILE_SIZE / 2;
        this._spriteContainer.position.set(center.x - anchorX, center.y - anchorY);
    }
}

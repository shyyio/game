import {Container} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {EasySprite} from "@/client/EasySprite.js";
import Mouse from "@/client/Mouse.js";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";
import {GHOST_TINT, GHOST_ALPHA, GHOST_BLOCKED_TINT, GHOST_BLOCKED_ALPHA} from "@/client/Theme.js";

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
        // Ghost floats on the cursor; `_snapCallback` re-evaluates placement on each new snapped tile.
        this._followCursor = false;
        this._snapCallback = null;
        this._direction = Direction.UP;
        this._snapKey = null;
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
        this._direction = direction;
        this._snapKey = null;
        const sprite = new EasySprite(0, tileX, tileY, direction, this.textureRegistry.get(this._definition.textureName), this._definition);
        sprite.setGhost(blocked ? GHOST_BLOCKED_TINT : GHOST_TINT, blocked ? GHOST_BLOCKED_ALPHA : GHOST_ALPHA);
        this._sprite = sprite;
        this._spriteContainer.addChild(sprite);
        this._updateCenterPin();
    }

    /**
     * Enables the cursor-follow preview: off center-lock the ghost floats centered on the cursor, and
     * on each new snapped tile `callback(baseX, baseY, direction)` re-evaluates placement (updating the
     * feedback) and returns whether it's blocked.
     * @param {function(number, number, Direction): boolean} callback
     */
    setFollowCursor(callback) {
        this._followCursor = true;
        this._snapCallback = callback;
    }

    /**
     * Forces the next cursor-follow frame to re-evaluate placement even on the same tile (e.g. after a
     * placement changed occupancy).
     */
    invalidateSnap() {
        this._snapKey = null;
    }

    /**
     * Applies the current tint/alpha to the ghost sprite.
     * @param {boolean} blocked
     * @private
     */
    _tint(blocked) {
        this._sprite.setGhost(blocked ? GHOST_BLOCKED_TINT : GHOST_TINT, blocked ? GHOST_BLOCKED_ALPHA : GHOST_ALPHA);
    }

    clear() {
        if (this._sprite !== null) {
            this._sprite.destroy();
            this._spriteContainer.removeChild(this._sprite);
            this._sprite = null;
        }
        this._anchorTileX = null;
        this._anchorTileY = null;
        this._snapKey = null;
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
     * Re-pins the floating ghost to its target (cursor, or screen center in center-lock) each frame.
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        this._updateCenterPin();
    }

    /**
     * Each frame, floats the ghost's centroid onto its target — the cursor, or the screen center in
     * center-lock — snapping placement to the tile nearest that target (re-evaluating on each new tile).
     * @private
     */
    _updateCenterPin() {
        if (this._sprite === null || this.viewport === null) {
            this._spriteContainer.position.set(0, 0);
            return;
        }
        const target = this._targetPoint();
        if (target === null) {
            this._spriteContainer.position.set(0, 0);
            return;
        }
        if (this._followCursor) {
            const base = this.snapBase(this._direction);
            const key = `${base.x},${base.y},${this._direction}`;
            if (key !== this._snapKey) {
                this._snapKey = key;
                this._tint(this._snapCallback(base.x, base.y, this._direction));
            }
        }
        this._pinCentroidTo(target.x, target.y);
    }

    /**
     * The base tile the floating ghost currently snaps to for `direction`, or null when there's no
     * live target (no ghost/viewport, or the cursor hasn't moved yet). Synchronous, so a tap reads it
     * without waiting for the ticker.
     * @param {Direction} direction
     * @returns {{x: number, y: number}|null}
     */
    snapBase(direction) {
        if (this._sprite === null || this.viewport === null) {
            return null;
        }
        const target = this._targetPoint();
        if (target === null) {
            return null;
        }
        const centroid = this._centroidOffset(direction);
        return {
            x: Math.round(target.x / TILE_SIZE - centroid.x - 0.5),
            y: Math.round(target.y / TILE_SIZE - centroid.y - 0.5),
        };
    }

    /**
     * The world point the ghost centers on: the screen center in center-lock, else the cursor.
     * @private
     * @returns {{x: number, y: number}|null}
     */
    _targetPoint() {
        if (this._centerLock) {
            return this.viewport.toWorld(this.viewport.screenWidth / 2, this.viewport.screenHeight / 2);
        }
        if (Mouse.currentX === null) {
            return null;
        }
        return {x: Mouse.currentX, y: Mouse.currentY};
    }

    /**
     * Offsets the container so the ghost sprite's centroid lands on world (`x`, `y`).
     * @private
     */
    _pinCentroidTo(x, y) {
        this._spriteContainer.position.set(x - this._sprite.position.x, y - this._sprite.position.y);
    }

    /**
     * The geometry centroid (in tiles) for `direction`, so a 1x1 pins on its tile and a 2x2 on its
     * center.
     * @private
     * @returns {{x: number, y: number}}
     */
    _centroidOffset(direction) {
        // The geometry is a filled rectangle from (0,0) to its corner, so its centroid is corner/2.
        const corner = this._definition.geometry.corner(direction);
        return {x: corner.x / 2, y: corner.y / 2};
    }
}

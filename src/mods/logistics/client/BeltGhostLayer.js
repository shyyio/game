import {AbstractDrawLayer, currentAnimationFrame, Container, Mouse, TILE_SIZE, LANE_LEVEL_SURFACE} from "@spup/sdk/client";
import {
    BELT_UNDERGROUND,
    getBuildLevelByBeltKind,
    getDrawLevelByBeltKind,
} from "../common/constants.js";
import {BeltSprite, beltFrameBase, ELEVATED_DRAW_HEIGHT} from "./BeltDrawLayer.js";

// Tints for tool preview ghosts.
const GHOST_TINT = 0xFFFFFF; // untinted normal preview
const GHOST_ALPHA = 0.8; // semi-transparent so the world shows through
const GHOST_AT_MAX_TINT = 0xF2A900; // tunnel at max length (amber)
const GHOST_BLOCKED_TINT = 0xF23030; // blocked (red), matches PlacementFeedbackLayer
const GHOST_BLOCKED_ALPHA = 0.8;

/**
 * Whether a kind's ghost stays on its tile rather than floating onto the cursor: a ramp and an
 * elevated cell both draw off the ground, which only reads against the tile they stand on.
 * @param {BeltType} beltType
 * @returns {boolean}
 */
function shouldSnapGhost(beltType) {
    return getBuildLevelByBeltKind(beltType) > LANE_LEVEL_SURFACE;
}

/**
 * Renders a belt tool's ghost preview, centered on the cursor (or screen center in center-lock).
 */
export class BeltGhostLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._sprites = [];
        // Placed tile's sprite floats onto the cursor.
        this._floatingContainer = new Container();
        // Buried tunnel belts stay grid-aligned.
        this._gridContainer = new Container();

        this.addChild(this._gridContainer);
        this.addChild(this._floatingContainer);

        this._centerLock = false;
        // Float anchor: the ghost's primary tile.
        this._anchorTileX = null;
        this._anchorTileY = null;
    }

    get layerIndex() {
        return 200;
    }

    /**
     * Stays visible in map mode.
     * @param {boolean} value
     */
    set isMapMode(value) {}

    /**
     * Shows a single ghost belt/mouth at the tile facing `direction`.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {BeltType} beltType
     * @param {Direction} [incoming] the way items travel as they enter the belt
     * @param {boolean} [isBlocked] tints the ghost red
     */
    showGhost(tileX, tileY, direction, beltType, incoming=direction, isBlocked=false) {
        this.clear();
        const tint = isBlocked ? GHOST_BLOCKED_TINT : GHOST_TINT;
        const alpha = isBlocked ? GHOST_BLOCKED_ALPHA : GHOST_ALPHA;
        if (shouldSnapGhost(beltType)) {
            this._addSprite(this._gridContainer, tileX, tileY, direction, beltType, tint, incoming, alpha);
        } else {
            this._anchorTileX = tileX;
            this._anchorTileY = tileY;
            this._addSprite(this._floatingContainer, tileX, tileY, direction, beltType, tint, incoming, alpha);
        }
        this._layoutPin();
    }

    /**
     * Shows the mouth at the hover tile plus the buried belts back to its pair.
     * @param {number} mouthTileX
     * @param {number} mouthTileY
     * @param {Direction} direction
     * @param {BeltType} mouthType TUNNEL_DOWN / TUNNEL_UP
     * @param {{x: number, y: number}[]} undergroundTiles tunnel tiles between the pair
     * @param {boolean} isAtMax tints the buried belts amber at maximum tunnel length
     */
    showTunnelPreview(mouthTileX, mouthTileY, direction, mouthType, undergroundTiles, isAtMax) {
        this.clear();
        this._anchorTileX = mouthTileX;
        this._anchorTileY = mouthTileY;
        this._addSprite(this._floatingContainer, mouthTileX, mouthTileY, direction, mouthType, GHOST_TINT, direction);
        const undergroundTint = isAtMax ? GHOST_AT_MAX_TINT : GHOST_TINT;
        for (const tile of undergroundTiles) {
            this._addSprite(this._gridContainer, tile.x, tile.y, direction, BELT_UNDERGROUND, undergroundTint, direction);
        }
        this._layoutPin();
    }

    /**
     * Builds one ghost sprite and adds it to `container`.
     * @param {Container} container floating or grid-aligned
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {BeltType} beltType
     * @param {number} tint
     * @param {Direction} incoming the way items travel as they enter the belt
     * @param {number} [alpha]
     * @private
     */
    _addSprite(container, tileX, tileY, direction, beltType, tint, incoming, alpha=GHOST_ALPHA) {
        const frames = this.textureCache.getAnimation(beltFrameBase(incoming, direction, beltType));
        const sprite = new BeltSprite(0, tileX, tileY, frames);
        sprite.setAnimationFrame(currentAnimationFrame());
        sprite.setGhost(tint, alpha);
        sprite.y -= getDrawLevelByBeltKind(beltType) * ELEVATED_DRAW_HEIGHT;

        this._sprites.push(sprite);
        container.addChild(sprite);
    }

    clear() {
        for (const sprite of this._sprites) {
            sprite.destroy();
            this._floatingContainer.removeChild(sprite);
            this._gridContainer.removeChild(sprite);
        }
        this._sprites.splice(0);
        this._anchorTileX = null;
        this._anchorTileY = null;
    }

    /**
     * Toggles center-lock: the ghost floats onto the screen center instead of the cursor.
     * @param {boolean} enabled
     */
    setCenterLock(enabled) {
        this._centerLock = enabled;
        this._layoutPin();
    }

    /**
     * Keeps the ghost on the shared animation frame and floating on its target.
     * @param {number} frame in [0, 8)
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     */
    tick(frame, deltaMS, visibleChunks) {
        for (const sprite of this._sprites) {
            sprite.setAnimationFrame(frame);
        }
        this._layoutPin();
    }

    /**
     * Offsets the floating container so the anchor tile's center lands on its target.
     * @private
     */
    _layoutPin() {
        const target = this._targetPoint();
        if (this._anchorTileX === null || target === null) {
            this._floatingContainer.position.set(0, 0);
            return;
        }
        const anchorX = this._anchorTileX * TILE_SIZE + TILE_SIZE / 2;
        const anchorY = this._anchorTileY * TILE_SIZE + TILE_SIZE / 2;
        this._floatingContainer.position.set(target.x - anchorX, target.y - anchorY);
    }

    /**
     * The world point the ghost centers on: the screen center in center-lock, else the cursor.
     * @private
     * @returns {Point|null}
     */
    _targetPoint() {
        if (this.viewport === null) {
            return null;
        }
        if (this._centerLock) {
            return this.viewport.toWorld(this.viewport.screenWidth / 2, this.viewport.screenHeight / 2);
        }
        if (Mouse.currentX === null || Mouse.currentY === null) {
            return null;
        }
        return {x: Mouse.currentX, y: Mouse.currentY};
    }
}

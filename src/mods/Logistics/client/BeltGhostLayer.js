import {AbstractDrawLayer, currentAnimationFrame, Container, Mouse, TILE_SIZE} from "@spup/sdk/client";
import {BeltBend, BELT_UNDERGROUND} from "../common/constants.js";
import {BeltSprite, beltFrameBase} from "./BeltDrawLayer.js";

// Tints for tool preview ghosts.
const GHOST_TINT = 0xFFFFFF; // untinted normal preview
const GHOST_ALPHA = 0.8; // semi-transparent so the world shows through
const GHOST_AT_MAX_TINT = 0xF2A900; // tunnel at max length (amber)
const GHOST_BLOCKED_TINT = 0xF23030; // blocked (red), matches PlacementFeedbackLayer
const GHOST_BLOCKED_ALPHA = 0.8;

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
    set mapMode(value) {}

    /**
     * Shows a single ghost belt/mouth at the tile facing `direction`.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {BeltType} beltType
     * @param {BeltBend} [bend]
     * @param {boolean} [blocked] tints the ghost red
     */
    showGhost(tileX, tileY, direction, beltType, bend=BeltBend.STRAIGHT, blocked=false) {
        this.clear();
        this._anchorTileX = tileX;
        this._anchorTileY = tileY;
        const tint = blocked ? GHOST_BLOCKED_TINT : GHOST_TINT;
        const alpha = blocked ? GHOST_BLOCKED_ALPHA : GHOST_ALPHA;
        this._addSprite(this._floatingContainer, tileX, tileY, direction, beltType, tint, bend, alpha);
        this._updatePin();
    }

    /**
     * Shows the mouth at the hover tile plus the buried belts back to its pair.
     * @param {number} mouthTileX
     * @param {number} mouthTileY
     * @param {Direction} direction
     * @param {BeltType} mouthType TUNNEL_DOWN / TUNNEL_UP
     * @param {{x: number, y: number}[]} undergroundTiles tunnel tiles between the pair
     * @param {boolean} atMax tints the buried belts amber at maximum tunnel length
     */
    showTunnelPreview(mouthTileX, mouthTileY, direction, mouthType, undergroundTiles, atMax) {
        this.clear();
        this._anchorTileX = mouthTileX;
        this._anchorTileY = mouthTileY;
        this._addSprite(this._floatingContainer, mouthTileX, mouthTileY, direction, mouthType, GHOST_TINT, BeltBend.STRAIGHT);
        const undergroundTint = atMax ? GHOST_AT_MAX_TINT : GHOST_TINT;
        for (const tile of undergroundTiles) {
            this._addSprite(this._gridContainer, tile.x, tile.y, direction, BELT_UNDERGROUND, undergroundTint, BeltBend.STRAIGHT);
        }
        this._updatePin();
    }

    /**
     * Builds one ghost sprite and adds it to `container`.
     * @param container {Container} floating or grid-aligned
     * @param tileX {number}
     * @param tileY {number}
     * @param direction {Direction}
     * @param beltType {BeltType}
     * @param {number} tint
     * @param {BeltBend} bend
     * @param {number} [alpha]
     * @private
     */
    _addSprite(container, tileX, tileY, direction, beltType, tint, bend, alpha=GHOST_ALPHA) {
        const frames = this.textureRegistry.getAnimation(beltFrameBase(bend, beltType));
        const sprite = new BeltSprite(
            0,
            tileX,
            tileY,
            direction,
            bend,
            beltType,
            frames,
        );
        sprite.setAnimationFrame(currentAnimationFrame());
        sprite.setGhost(tint, alpha);

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
        this._updatePin();
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
        this._updatePin();
    }

    /**
     * Offsets the floating container so the anchor tile's center lands on its target.
     * @private
     */
    _updatePin() {
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
     * @returns {{x: number, y: number}|null}
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

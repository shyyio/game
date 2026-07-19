import {AbstractDrawLayer, currentAnimationFrame, Container, Mouse, TILE_SIZE} from "@/sdk/client.js";
import {BeltBend, BeltType} from "./constants.js";
import {BeltSprite, beltFrameBase} from "./BeltLayer.js";

// Tints for tool preview ghosts.
const GHOST_TINT = 0xFFFFFF; // normal placement preview: untinted (natural sprite color)
const GHOST_ALPHA = 0.8; // ghosts are always semi-transparent so the world shows through
const GHOST_AT_MAX_TINT = 0xF2A900; // tunnel preview at maximum length (amber)
const GHOST_BLOCKED_TINT = 0xF23030; // placement blocked (red), matches PlacementFeedbackLayer
const GHOST_BLOCKED_ALPHA = 0.8;

/**
 * Renders a belt tool's hovering "ghost" preview, floating centered on the cursor (or on the screen
 * center in center-lock). The per-tile feedback (red/green) is the PlacementFeedbackLayer's job.
 */
export class BeltGhostLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._sprites = [];
        // The placed tile's sprite lives here so it can float onto the cursor.
        this._floatingContainer = new Container();
        // A tunnel's buried belts connect to a ramp already on the grid, so they stay grid-aligned.
        this._gridContainer = new Container();

        this.addChild(this._gridContainer);
        this.addChild(this._floatingContainer);

        this._centerLock = false;
        // The primary tile of the current ghost (the belt/ramp tile), the float anchor.
        this._anchorTileX = null;
        this._anchorTileY = null;
    }

    get layerIndex() {
        return 200;
    }

    /**
     * Shows a single ghost belt/ramp at the tile facing `direction` (ramps/undergrounds ignore `bend`).
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {BeltType} beltType
     * @param {BeltBend} [bend]
     * @param {boolean} [blocked] tints the ghost red when the tile can't be placed on
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
     * Shows the ghost a completed underground tunnel would produce: the ramp at the
     * hover tile plus the line of buried belts that would be laid back to its pair.
     * @param {number} rampTileX
     * @param {number} rampTileY
     * @param {Direction} direction
     * @param {BeltType} rampType ramp placed at the hover tile (RAMP_DOWN / RAMP_UP)
     * @param {{x: number, y: number}[]} undergroundTiles tunnel tiles between the pair
     * @param {boolean} atMax whether the tunnel is at its maximum length and cannot
     *     be extended further; tints the buried belts amber as a warning while the
     *     ramp keeps the normal preview tint
     */
    showTunnelPreview(rampTileX, rampTileY, direction, rampType, undergroundTiles, atMax) {
        this.clear();
        this._anchorTileX = rampTileX;
        this._anchorTileY = rampTileY;
        this._addSprite(this._floatingContainer, rampTileX, rampTileY, direction, rampType, GHOST_TINT, BeltBend.STRAIGHT);
        const undergroundTint = atMax ? GHOST_AT_MAX_TINT : GHOST_TINT;
        for (const tile of undergroundTiles) {
            this._addSprite(this._gridContainer, tile.x, tile.y, direction, BeltType.UNDERGROUND, undergroundTint, BeltBend.STRAIGHT);
        }
        this._updatePin();
    }

    /**
     * Builds one ghost sprite and adds it to `container`.
     * @param container {Container} floating (the placed tile) or grid-aligned (buried belts)
     * @param tileX {number}
     * @param tileY {number}
     * @param direction {Direction}
     * @param beltType {BeltType}
     * @param {number} tint ghost tint applied to the sprite
     * @param {BeltBend} bend the bend the sprite renders with
     * @param {number} [alpha] sprite opacity
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
     * Toggles center-lock presentation: the ghost floats onto the screen center instead of the cursor.
     * @param {boolean} enabled
     */
    setCenterLock(enabled) {
        this._centerLock = enabled;
        this._updatePin();
    }

    /**
     * Keeps the ghost preview on the shared animation frame and floating on its target.
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        for (const sprite of this._sprites) {
            sprite.setAnimationFrame(frame);
        }
        this._updatePin();
    }

    /**
     * Offsets the floating container each frame so the anchor tile's center lands on its target —
     * the cursor, or the screen center in center-lock.
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
        if (Mouse.currentX === null) {
            return null;
        }
        return {x: Mouse.currentX, y: Mouse.currentY};
    }
}

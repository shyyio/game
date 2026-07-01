import {AbstractDrawLayer, currentAnimationFrame, Container, Graphics, TILE_SIZE} from "@/sdk/client.js";
import {BeltBend, BeltType} from "./constants.js";
import {BeltSprite, beltFrameBase} from "./BeltLayer.js";

// Tints for tool preview ghosts.
const GHOST_TINT = 0xFFFFFF; // normal placement preview: untinted (natural sprite color)
const GHOST_ALPHA = 0.9; // ghosts are always semi-transparent so the world shows through
const GHOST_AT_MAX_TINT = 0xF2A900; // tunnel preview at maximum length (amber)
const GHOST_BLOCKED_TINT = 0xF23030; // placement blocked (red), matches PlacementFeedbackLayer
const GHOST_BLOCKED_ALPHA = 0.8;

// Green marker drawn on the locked placement target tile in center-lock mode: an
// inset square with a semi-transparent fill and an opaque border.
const TARGET_TILE_COLOR = 0x4CFF50;
const TARGET_TILE_FILL_ALPHA = 0.22;
const TARGET_TILE_BORDER_WIDTH = 3;

/**
 * Renders a belt tool's hovering "ghost" preview, pinned to the screen center in center-lock mode.
 */
export class BeltGhostLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._sprites = [];
        // Ghost sprites live here so the whole set can be shifted to the screen
        // center in center-lock mode without moving the target highlight.
        this._spriteContainer = new Container();

        // Grid-aligned green marker on the locked target tile (center-lock only).
        this._targetGraphics = new Graphics();
        this.addChild(this._targetGraphics);

        this.addChild(this._spriteContainer);

        this._centerLock = false;
        // The primary tile of the current ghost (the belt/ramp tile), used as the
        // pin anchor and the target-highlight tile.
        this._anchorTileX = null;
        this._anchorTileY = null;
        // Whether the current ghost is pinned to the screen center in center-lock.
        // A single-tile ghost is pinned (held fixed at center); a tunnel preview is
        // not, so its line of buried belts stays aligned to the grid.
        this._pinToCenter = true;
        // Whether the current ghost sits on a blocked tile. The green target marker
        // is suppressed when set, leaving the PlacementFeedbackLayer's red square to mark
        // the tile (the two are mutually exclusive).
        this._blocked = false;
    }

    get layerIndex() {
        return 200;
    }

    onEvent(event) {
        // No-op: the ghost reacts to tool hover, not to game journal events.
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
        this._pinToCenter = true;
        this._blocked = blocked;
        const tint = blocked ? GHOST_BLOCKED_TINT : GHOST_TINT;
        const alpha = blocked ? GHOST_BLOCKED_ALPHA : GHOST_ALPHA;
        this._addSprite(tileX, tileY, direction, beltType, tint, bend, alpha);
        this._drawTarget();
        this._updateCenterPin();
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
        // A tunnel preview connects to a fixed pair ramp on the grid, so it follows
        // the grid rather than being pinned to center.
        this._pinToCenter = false;
        // A tunnel preview is only shown for a valid (unblocked) placement.
        this._blocked = false;
        this._addSprite(rampTileX, rampTileY, direction, rampType, GHOST_TINT, BeltBend.STRAIGHT);
        const undergroundTint = atMax ? GHOST_AT_MAX_TINT : GHOST_TINT;
        undergroundTiles.forEach(tile => {
            this._addSprite(tile.x, tile.y, direction, BeltType.UNDERGROUND, undergroundTint, BeltBend.STRAIGHT);
        });
        this._drawTarget();
        this._updateCenterPin();
    }

    /**
     * Builds one ghost sprite and adds it to the layer.
     * @param tileX {number}
     * @param tileY {number}
     * @param direction {Direction}
     * @param beltType {BeltType}
     * @param {number} tint ghost tint applied to the sprite
     * @param {BeltBend} bend the bend the sprite renders with
     * @param {number} [alpha] sprite opacity
     * @private
     */
    _addSprite(tileX, tileY, direction, beltType, tint, bend, alpha=GHOST_ALPHA) {
        const frames = this.textureRegistry.getAnimation(beltFrameBase(bend, beltType));
        const sprite = new BeltSprite(
            0n,
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
        this._spriteContainer.addChild(sprite);
    }

    clear() {
        this._sprites.forEach(sprite => {
            sprite.destroy();
            this._spriteContainer.removeChild(sprite);
        });
        this._sprites.splice(0);
        this._targetGraphics.clear();
        this._anchorTileX = null;
        this._anchorTileY = null;
        this._blocked = false;
    }

    /**
     * Toggles center-lock presentation: pin the ghost to screen center and mark the target tile.
     * @param {boolean} enabled
     */
    setCenterLock(enabled) {
        this._centerLock = enabled;
        if (!enabled) {
            this._spriteContainer.position.set(0, 0);
            this._targetGraphics.clear();
            return;
        }
        // A ghost may already be shown when the lock turns on; mark its target.
        this._drawTarget();
    }

    /**
     * Draws the green target-tile marker under the ghost; center-lock only.
     * @private
     */
    _drawTarget() {
        this._targetGraphics.clear();
        if (!this._centerLock || !this._pinToCenter || this._anchorTileX === null || this._blocked) {
            // No marker when the ghost already follows the grid (the tunnel preview)
            // or sits on a blocked tile (the PlacementFeedbackLayer's red square marks it
            // instead): the green target is mutually exclusive with both.
            return;
        }
        this._targetGraphics
            .rect(
                this._anchorTileX * TILE_SIZE,
                this._anchorTileY * TILE_SIZE,
                TILE_SIZE,
                TILE_SIZE,
            )
            .fill({color: TARGET_TILE_COLOR, alpha: TARGET_TILE_FILL_ALPHA})
            .stroke({width: TARGET_TILE_BORDER_WIDTH, color: TARGET_TILE_COLOR});
    }

    /**
     * Keeps the ghost preview on the shared animation frame, and (in center-lock)
     * pins the ghost sprites to the screen center so they stay fixed while panning.
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        this._sprites.forEach(sprite => {
            sprite.setAnimationFrame(frame);
        });
        this._updateCenterPin();
    }

    /**
     * Offsets the sprite container each frame so the anchor tile renders at the screen center.
     * @private
     */
    _updateCenterPin() {
        if (!this._centerLock || !this._pinToCenter || this._anchorTileX === null || this.viewport === null) {
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

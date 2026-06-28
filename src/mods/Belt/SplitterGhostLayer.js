import {AbstractDrawLayer} from "@/sdk/client.js";
import {SplitterSprite} from "./SplitterLayer.js";

// Tints for the placement-preview ghost (shared with the belt tools' palette).
const GHOST_TINT = 0xC8F902; // normal placement preview (green)
const GHOST_BLOCKED_TINT = 0xF23030; // placement blocked (red)
const GHOST_BLOCKED_ALPHA = 0.8;
const SPLITTER_TEXTURE = "splitter/1";

/**
 * Renders the splitter tool's hovering placement-preview ghost.
 */
export class SplitterGhostLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._sprite = null;
    }

    get layerIndex() {
        return 200;
    }

    onEvent(event) {
        // No-op: the ghost reacts to tool hover, not to game events.
    }

    /**
     * Shows a single splitter ghost at the tile facing `direction`, tinted red when blocked.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {boolean} [blocked]
     */
    showGhost(tileX, tileY, direction, blocked=false) {
        this.clear();
        const tint = blocked ? GHOST_BLOCKED_TINT : GHOST_TINT;
        const alpha = blocked ? GHOST_BLOCKED_ALPHA : 1;
        const sprite = new SplitterSprite(0n, tileX, tileY, direction, this.textureRegistry.get(SPLITTER_TEXTURE));
        sprite.setGhost(tint, alpha);
        this.addChild(sprite);
        this._sprite = sprite;
    }

    clear() {
        if (this._sprite !== null) {
            this._sprite.destroy();
            this.removeChild(this._sprite);
            this._sprite = null;
        }
    }
}

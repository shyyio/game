import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {ObjectSprite} from "@/client/layers/ObjectSprite.js";

/**
 * Draws inspect highlights on hover. Mods drive it with InspectHighlights.
 */
export class InspectLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._sprites = [];
    }

    get layerIndex() {
        // Above object/overlay/ghost layers.
        return 300;
    }

    /**
     * Stays visible in map mode: the hover highlight reads at any zoom.
     * @param {boolean} value
     */
    set isMapMode(value) {}

    /**
     * Replaces the current highlights (empty clears).
     * @param {InspectHighlightSprite[]} highlights
     */
    show(highlights) {
        this.clear();
        for (const highlight of highlights) {
            let variantSuffix;
            if (highlight.alt) {
                variantSuffix = "-alt";
            } else {
                variantSuffix = "";
            }
            const texture = this.textureCache.get(`inspect/${highlight.type.geometryName}${variantSuffix}`);
            const sprite = new ObjectSprite(0, highlight.tileX, highlight.tileY, highlight.direction, texture, highlight.type);
            sprite.y -= highlight.drawHeight;
            this.addChild(sprite);
            this._sprites.push(sprite);
        }
    }

    /**
     * Hides or reveals the highlights; a bracketed item outranks them. Rides `renderable`, since
     * the view-mode machinery owns `visible`.
     * @param {boolean} isSuppressed
     * @returns {void}
     */
    setSuppressed(isSuppressed) {
        this.renderable = !isSuppressed;
    }

    clear() {
        for (const sprite of this._sprites) {
            sprite.destroy();
            this.removeChild(sprite);
        }
        this._sprites.splice(0);
    }
}

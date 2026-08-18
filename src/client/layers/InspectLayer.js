import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {ObjectSprite} from "@/client/layers/ObjectSprite.js";

/**
 * Draws inspect highlights on hover. Mods drive it with InspectHighlights.
 */
export class InspectLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._sprites = [];
        /**
         * Whether a hovered item outranks these highlights, hiding them.
         * @type {boolean}
         * @private
         */
        this._suppressed = false;
    }

    get layerIndex() {
        // Above object/overlay/ghost layers.
        return 300;
    }

    /**
     * Stays visible in map mode: the hover highlight reads at any zoom.
     * @param {boolean} value
     */
    set mapMode(value) {}

    /**
     * Replaces the current highlights (empty clears).
     * @param {InspectHighlight[]} highlights
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
            const texture = this.textureRegistry.get(`inspect/${highlight.type.geometryName}${variantSuffix}`);
            const sprite = new ObjectSprite(0, highlight.tileX, highlight.tileY, highlight.direction, texture, highlight.type);
            this.addChild(sprite);
            this._sprites.push(sprite);
        }
        this._applySuppressed();
    }

    /**
     * Hides or reveals the highlights, driven by {@link ItemInspectLayer} when an item is
     * bracketed under the cursor.
     * @param {boolean} suppressed
     * @returns {void}
     */
    setSuppressed(suppressed) {
        this._suppressed = suppressed;
        this._applySuppressed();
    }

    /**
     * @private
     * @returns {void}
     */
    _applySuppressed() {
        for (const sprite of this._sprites) {
            sprite.visible = !this._suppressed;
        }
    }

    clear() {
        for (const sprite of this._sprites) {
            sprite.destroy();
            this.removeChild(sprite);
        }
        this._sprites.splice(0);
    }
}

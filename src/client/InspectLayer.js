import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {EasySprite} from "@/client/EasySprite.js";

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

    onEvent(event) {
        // No-op: driven by hover, not game events.
    }

    /**
     * Replaces the current highlights (empty clears).
     * @param {InspectHighlight[]} highlights
     */
    show(highlights) {
        this.clear();
        highlights.forEach(highlight => {
            const texture = this.textureRegistry.get(`inspect/${highlight.definition.geometryName}${highlight.alt ? "-alt" : ""}`);
            const sprite = new EasySprite(0, highlight.tileX, highlight.tileY, highlight.direction, texture, highlight.definition);
            this.addChild(sprite);
            this._sprites.push(sprite);
        });
    }

    clear() {
        this._sprites.forEach(sprite => {
            sprite.destroy();
            this.removeChild(sprite);
        });
        this._sprites.splice(0);
    }
}

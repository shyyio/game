import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {EasySprite} from "@/client/EasySprite.js";

/**
 * Shared layer that highlights objects a mod marks on hover; driven imperatively by mods with
 * InspectHighlights.
 */
export class InspectLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._sprites = [];
    }

    get layerIndex() {
        // Above the object/overlay/ghost layers so the highlight sits on top.
        return 300;
    }

    onEvent(event) {
        // No-op: the inspect highlight is driven by hover, not by game events.
    }

    /**
     * Highlights the given objects, replacing any previous (empty clears). Each is sized/rotated to its
     * geometry — a 1x2 splitter draws a single 1x2 highlight; `alt` uses the alternate texture.
     * @param {InspectHighlight[]} highlights
     */
    show(highlights) {
        this.clear();
        highlights.forEach(highlight => {
            const texture = this.textureRegistry.require(`inspect/${highlight.definition.geometryName}${highlight.alt ? "-alt" : ""}`);
            const sprite = new EasySprite(0n, highlight.tileX, highlight.tileY, highlight.direction, texture, highlight.definition);
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

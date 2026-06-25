import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {Sprite} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";

// The hover-highlight sprites: the primary one over the hovered object, and the
// alternate over a related object (e.g. the ramp the hovered ramp tunnels to).
const INSPECT_TEXTURE = "inspect/1x1";
const INSPECT_ALT_TEXTURE = "inspect/1x1-alt";

/**
 * Shared layer that highlights tiles a mod marks on hover; driven imperatively by mods.
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
     * Highlights the given tiles (`alt: true` uses the alternate texture), replacing any previous; empty clears.
     * @param {{x: number, y: number, alt?: boolean}[]} tiles
     */
    show(tiles) {
        this.clear();
        tiles.forEach(tile => {
            const texture = tile.alt === true ? INSPECT_ALT_TEXTURE : INSPECT_TEXTURE;
            const sprite = new Sprite(this.textureRegistry.get(texture));
            sprite.anchor = 0.5;
            sprite.position.set(tile.x * TILE_SIZE + TILE_SIZE / 2, tile.y * TILE_SIZE + TILE_SIZE / 2);
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

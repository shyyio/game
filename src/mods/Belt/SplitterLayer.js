import {Sprite, Texture, TILE_SIZE, Direction, AbstractDrawLayer} from "@/sdk/client.js";

// The 1x2 splitter sprite (two tiles wide, facing up).
const SPLITTER_TEXTURE = "splitter/1";

export class SplitterSprite extends Sprite {

    /**
     * @param {BigInt} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {Texture|undefined} texture
     */
    constructor(id, x, y, direction, texture) {
        super(texture === undefined ? Texture.EMPTY : texture);

        this.id = id;
        this.tileX = x;
        this.tileY = y;
        this.direction = direction;
        this.anchor = 0.5;
        this.angle = Direction.angle(direction);

        // Center the two-tile sprite over its footprint midpoint: the base tile's
        // center shifted a half-tile toward the second cell (one step clockwise of facing).
        const perp = Direction.rotate(direction, 1);
        this.position.set(
            x * TILE_SIZE + TILE_SIZE / 2 + Direction.dx(perp) * TILE_SIZE / 2,
            y * TILE_SIZE + TILE_SIZE / 2 + Direction.dy(perp) * TILE_SIZE / 2,
        );
    }

    /**
     * Renders this sprite as a placement-preview ghost in the given tint and alpha.
     * @param {number} tint
     * @param {number} [alpha]
     */
    setGhost(tint, alpha=1) {
        this.tint = tint;
        this.alpha = alpha;
    }
}

export class SplitterDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._splitters = {};
    }

    get layerIndex() {
        // Above belts (10) and belt items (15): a splitter is a structure sitting over the belts it joins.
        return 20;
    }

    /**
     * No-op: splitter rendering is driven imperatively by BeltClientMod, not by events.
     * @param {AbstractEvent} event
     */
    onEvent(event) {}

    /**
     * Renders a newly-placed or chunk-synced splitter.
     * @param {BigInt} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     */
    addSplitter(id, x, y, direction) {
        const sprite = new SplitterSprite(id, x, y, direction, this.textureRegistry.get(SPLITTER_TEXTURE));
        this.addChild(sprite);
        this._splitters[id] = sprite;
    }

    /**
     * @param {BigInt} id
     */
    removeSplitter(id) {
        const sprite = this._splitters[id];
        if (sprite === undefined) {
            return;
        }
        sprite.destroy();
        this.removeChild(sprite);
        delete this._splitters[id];
    }
}

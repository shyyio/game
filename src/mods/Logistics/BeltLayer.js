import {Graphics, Sprite, Texture, TILE_SIZE, Direction, AbstractDrawLayer, currentAnimationFrame} from "@/sdk/client.js";
import {BeltBend, BeltType} from "./constants.js";
import {inferBeltParent} from "./geometry.js";

// Map-mode tile fill colors, keyed by belt type.
const MAP_TILE_COLOR = 0xf7df9e;
const MAP_RAMP_COLOR = 0xc8a16e;

/**
 * The spritesheet base sequence name for a belt of the given bend and type (frames live under "<base>/0..7").
 * @param {BeltBend} bend
 * @param {BeltType} type
 * @returns {string}
 */
export function beltFrameBase(bend, type) {
    if (type === BeltType.UNDERGROUND) {
        return "belt-underground";
    }
    if (type === BeltType.RAMP_UP) {
        return "belt-ramp-up";
    }
    if (type === BeltType.RAMP_DOWN) {
        return "belt-ramp-down";
    }
    if (bend === BeltBend.LEFT) {
        return "belt-left";
    }
    if (bend === BeltBend.RIGHT) {
        return "belt-right";
    }
    return "belt-straight";
}

export class Belt {

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltBend} bend
     * @param {BeltType} type
     */
    constructor(id, x, y, direction, bend, type) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.parentX = x;
        this.parentY = y;
        this.direction = direction;
        this.bend = bend;
        this.type = type;
    }

    static getBend(direction, x, y, parentX, parentY) {
        if (parentX === null) {
            return BeltBend.STRAIGHT;
        }

        if (direction === Direction.UP && parentX > x) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.UP && parentX < x) {
            return BeltBend.LEFT;
        } else if (direction === Direction.DOWN && parentX > x) {
            return BeltBend.LEFT;
        } else if (direction === Direction.DOWN && parentX < x) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.LEFT && parentY < y) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.LEFT && parentY > y) {
            return BeltBend.LEFT;
        } else if (direction === Direction.RIGHT && parentY < y) {
            return BeltBend.LEFT;
        } else if (direction === Direction.RIGHT && parentY > y) {
            return BeltBend.RIGHT;
        }

        return BeltBend.STRAIGHT;
    }
}

export class BeltDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();

        this._belts = {};
        this._mapModeBelts = {};
        this._mapMode = false;
        this._bendsStale = false;
    }

    get layerIndex() {
        return 10;
    }

    /**
     * Injected by Client.init; subscribing to structural cache changes flags bends for a
     * one-pass rebuild on the next tick, since a belt's bend depends on neighboring objects
     * of any mod (belts, splitters, machines feeding it from the side).
     * @param {ClientCache|null} value
     */
    set cache(value) {
        this._cache = value;
        if (value !== null) {
            value.onStructuralChange(() => {
                this._bendsStale = true;
            });
        }
    }

    /**
     * @returns {ClientCache|null}
     */
    get cache() {
        return this._cache;
    }

    /**
     * Toggles map mode by swapping each belt's full sprite for its persistent
     * map-mode rectangle (both are kept loaded, so this is just a visibility flip).
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
        Object.values(this._belts).forEach(sprite => {
            sprite.visible = !value;
        });
        Object.values(this._mapModeBelts).forEach(sprite => {
            sprite.visible = value;
        });
    }

    /**
     * Builds the persistent map-mode rectangle shown for a belt in map mode,
     * colored by belt type and positioned over its tile.
     * @param {BeltSprite} sprite
     * @returns {Graphics}
     * @private
     */
    _createMapModeBelt(sprite) {
        const color = sprite.type === BeltType.NORMAL ? MAP_TILE_COLOR : MAP_RAMP_COLOR;
        const mapModeSprite = new Graphics();
        mapModeSprite
            .rect(sprite.tileX * TILE_SIZE, sprite.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE)
            .fill(color);
        mapModeSprite.visible = this._mapMode;
        return mapModeSprite;
    }

    /**
     * No-op: belt rendering is driven imperatively by LogisticsClientMod, not by events.
     * @param {AbstractEvent} event
     */
    onEvent(event) {}

    /**
     * Renders a newly-placed or chunk-synced belt (undergrounds are buried and skipped). The
     * bend is added straight and re-derived from neighbors on the next structural cache change.
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltType} type
     */
    addBelt(id, x, y, direction, type) {
        if (type === BeltType.UNDERGROUND) {
            return;
        }
        const frames = this._getFrames(BeltBend.STRAIGHT, type);
        const sprite = new BeltSprite(id, x, y, direction, BeltBend.STRAIGHT, type, frames);
        sprite.setAnimationFrame(currentAnimationFrame());
        this.addChild(sprite);

        this._belts[sprite.id] = sprite;
        sprite.visible = !this._mapMode;

        const mapModeSprite = this._createMapModeBelt(sprite);
        this._mapModeBelts[sprite.id] = mapModeSprite;
        this.addChild(mapModeSprite);
    }

    /**
     * Re-derives a normal belt's bend from its cached neighbors, re-rendering only on a change.
     * @param {BeltSprite} sprite
     * @private
     */
    _applyBend(sprite) {
        const {parentX, parentY} = inferBeltParent(this.cache, sprite.tileX, sprite.tileY, sprite.direction);
        const bend = Belt.getBend(sprite.direction, sprite.tileX, sprite.tileY, parentX, parentY);
        if (bend === sprite.bend) {
            return;
        }
        sprite.frames = this._getFrames(bend, sprite.type);
        sprite.update(sprite.tileX, sprite.tileY, sprite.direction, bend);
    }

    /**
     * @param {number} id
     */
    removeBelt(id) {
        const belt = this._belts[id];

        if (belt === undefined) {
            return;
        }

        belt.destroy();
        this.removeChild(belt);
        delete this._belts[id];

        const mapModeBelt = this._mapModeBelts[id];
        if (mapModeBelt !== undefined) {
            mapModeBelt.destroy();
            this.removeChild(mapModeBelt);
            delete this._mapModeBelts[id];
        }
    }

    /**
     * Advances every live belt sprite to the shared animation frame, re-deriving bends in a
     * single pass when the cache changed structurally since the last tick (skipped in map mode).
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        if (this._mapMode || this.cache === null) {
            return;
        }
        const rebuildBends = this._bendsStale;
        this._bendsStale = false;
        Object.values(this._belts).forEach(sprite => {
            if (rebuildBends && sprite.type === BeltType.NORMAL) {
                this._applyBend(sprite);
            }
            sprite.setAnimationFrame(frame);
        });
    }

    /**
     * The ordered frame textures for a belt of the given bend and type.
     * @param {BeltBend} bend
     * @param {BeltType} type
     * @returns {Texture[]|undefined}
     */
    _getFrames(bend, type) {
        return this.textureRegistry.getAnimation(beltFrameBase(bend, type));
    }
}

export class BeltSprite extends Sprite {

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltBend} bend
     * @param {BeltType} type
     * @param {Texture[]|undefined} frames ordered animation frames for this bend/type
     */
    constructor(id, x, y, direction, bend, type, frames) {
        super(Texture.EMPTY);

        this.id = id;
        this.tileX = x;
        this.tileY = y;
        this.anchor = 0.5;
        this.angle = Direction.angle(direction);
        this.direction = direction;
        this.bend = bend;
        this.type = type;
        this.frames = frames;

        this.position.set(x * TILE_SIZE + 32, y * TILE_SIZE + 32);
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

    /**
     * Shows the given frame by array index, wrapping modulo the sequence length so single-frame sprites stay put.
     * @param {number} frame animation frame, in [0, 8)
     */
    setAnimationFrame(frame) {
        if (this.frames === undefined || this.frames.length === 0) {
            this.texture = Texture.EMPTY;
            return;
        }
        this.texture = this.frames[frame % this.frames.length];
    }

    update(x, y, direction, bend) {
        this.direction = direction;
        this.angle = Direction.angle(direction);
        this.bend = bend;
        this.tileX = x;
        this.tileY = y;
        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;
    }
}

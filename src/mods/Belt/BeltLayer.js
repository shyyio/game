import {Graphics, Sprite, Texture, TILE_SIZE, Direction, DrawLayer} from "@/sdk/client.js";
import {BeltBend, BeltType} from "./constants.js";
import {BeltInsertEvent, BeltUpdateEvent, BeltDeleteEvent} from "./events.js";

/**
 * The spritesheet frame name for a belt of the given bend and type. Shared by
 * the live belt layer and the ghost preview layer so both pick identical art.
 * @param {BeltBend} bend
 * @param {BeltType} type
 * @returns {string}
 */
export function beltFrameName(bend, type) {
    if (type === BeltType.RAMP_UP) {
        return "belt-ramp-up/0";
    }
    if (type === BeltType.RAMP_DOWN) {
        return "belt-ramp-down/0";
    }
    if (bend === BeltBend.LEFT) {
        return "belt-left/0";
    }
    if (bend === BeltBend.RIGHT) {
        return "belt-right/0";
    }
    return "belt-straight/0";
}

export class Belt {

    /**
     * @param {BigInt} id
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

export class BeltDrawLayer extends DrawLayer {

    constructor() {
        super();

        this.itemMask = new Graphics();
        this.addChild(this.itemMask);

        this._belts = {};
        this._masks = {};
    }

    get layerIndex() {
        return 10;
    }

    set lowRes(value) {
        // TODO: render belts as simple geometry at low res
    }

    /**
     * @param {BufferedEvent|LiveEvent} event
     */
    onEvent(event) {
        if (event instanceof BeltInsertEvent) {
            const bend = Belt.getBend(event.direction, event.x, event.y, event.parentX, event.parentY);
            const belt = new Belt(event.id, event.x, event.y, event.direction, bend, event.beltType);
            this.addBelt(belt);
        } else if (event instanceof BeltUpdateEvent) {
            const sprite = this._belts[event.id];
            if (sprite === undefined) {
                return;
            }
            const bend = Belt.getBend(sprite.direction, sprite.tileX, sprite.tileY, event.newParentX, event.newParentY);
            const texture = this._getTexture(bend, sprite.type);
            sprite.update(sprite.tileX, sprite.tileY, sprite.direction, bend, texture);
        } else if (event instanceof BeltDeleteEvent) {
            this.removeBelt(event.id);
        }
    }

    /**
     * @param {Belt} belt
     */
    addBelt(belt) {
        if (belt.type === BeltType.UNDERGROUND) {
            // Underground belts are buried — never rendered on the client. They
            // also can't be selected or deleted (see GetBeltAtTile).
            return;
        }
        const texture = this._getTexture(belt.bend, belt.type);
        const sprite = new BeltSprite(belt.id, belt.x, belt.y, belt.direction, belt.bend, belt.type, texture);
        this.addChild(sprite);

        if (sprite.type !== BeltType.NORMAL) {
            this._addMask(sprite.id, sprite.getItemMask());
        }

        this._belts[sprite.id] = sprite;
    }

    /**
     * @param {BigInt} id
     */
    hideBelt(id) {
        this.children.forEach(sprite => {
            sprite.visible = sprite.id !== id;
        });
    }

    /**
     * @param {BigInt} id
     */
    removeBelt(id) {
        const belt = this._belts[id];

        if (belt === undefined) {
            return;
        }

        belt.destroy();
        this.removeChild(belt);
        delete this._belts[id];
    }

    _addMask(id, rect) {
        this._masks[id] = rect;
        this._updateMask();
    }

    _updateMask() {
        this.itemMask.clear();
        Object.values(this._masks).forEach(rect => {
            this.itemMask.rect(rect.x, rect.y, rect.width, rect.height);
        });
        this.itemMask.fill(0xFFFFFF);
    }

    /**
     * @param {number} bend
     * @param {number} type
     * @returns {Texture}
     */
    // TODO: animate belts — each sprite has 8 frames (/0 to /7), cycle based on game tick.
    _getTexture(bend, type) {
        const texture = this.textureRegistry.get(beltFrameName(bend, type));
        return texture === undefined ? Texture.EMPTY : texture;
    }
}

export class BeltSprite extends Sprite {

    /**
     * @param {BigInt} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltBend} bend
     * @param {BeltType} type
     * @param {Texture} texture
     */
    constructor(id, x, y, direction, bend, type, texture) {
        super(texture);

        this.id = id;
        this.tileX = x;
        this.tileY = y;
        this.anchor = 0.5;
        this.angle = Direction.angle(direction);
        this.direction = direction;
        this.bend = bend;
        this.type = type;

        this.position.set(x * TILE_SIZE + 32, y * TILE_SIZE + 32);
    }

    /**
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    getItemMask() {
        if (this.type === BeltType.RAMP_UP || this.type === BeltType.RAMP_DOWN) {
            // TODO
            return {x: this.x, y: this.y, width: 0, height: 0};
        }

        return {
            x: this.x - 32,
            y: this.y - 32,
            width: TILE_SIZE,
            height: TILE_SIZE
        };
    }

    set ghost(value) {
        if (value === true) {
            this.alpha = 0.4;
            this.tint = 0xC8F902;
        }
    }

    update(x, y, direction, bend, texture) {
        this.direction = direction;
        this.angle = Direction.angle(direction);
        this.bend = bend;
        this.texture = texture;
        this.tileX = x;
        this.tileY = y;
        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;
    }
}

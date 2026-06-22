import {Graphics, Sprite, Texture, TILE_SIZE, Direction, DrawLayer} from "@/sdk/client.js";
import {BeltBend, BeltType, BeltInsertEvent, BeltUpdateEvent, BeltDeleteEvent} from "@/mods/Belt/mod.js";

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

    get zLevel() {
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
        let frameName;
        if (type === BeltType.RAMP_UP) {
            frameName = 'belt-ramp-up/0';
        } else if (type === BeltType.RAMP_DOWN) {
            frameName = 'belt-ramp-down/0';
        } else if (bend === BeltBend.LEFT) {
            frameName = 'belt-left/0';
        } else if (bend === BeltBend.RIGHT) {
            frameName = 'belt-right/0';
        } else {
            frameName = 'belt-straight/0';
        }
        return this.textureRegistry.get(frameName) ?? Texture.EMPTY;
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

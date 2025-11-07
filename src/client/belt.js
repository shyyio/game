import {Assets, Container, Graphics, Sprite, Texture} from "pixi.js";
import {TILE_SIZE} from "@/constants.js";
import {BeltBend, BeltType, Direction} from "@/backend/constants.js";
import {GameTextures} from "@/client/ClientRenderer.js";
import {Belt} from "@/client/ClientState.js";

export class BeltContainer extends Container {
    constructor() {
        super();

        this.itemMask = new Graphics();
        this.addChild(this.itemMask);

        this._belts = {};
        this._masks = {};
    }

    set lowRes(value) {
        // TODO: render belts as simple geometry
    }

    addMask(id, rect) {
        this._masks[id] = rect;
        this._updateMask();
    }

    _updateMask() {
        this.itemMask.clear();
        Object.values(this._masks).forEach(rect => {
            this.itemMask.rect(rect.x, rect.y, rect.width, rect.height)
        })

        this.itemMask.fill(0xFFFFFF);
    }
    /**
     * @param belt {Belt}
     */
    addBelt(belt) {
        const sprite = new BeltSprite(belt.id, belt.x, belt.y, belt.direction, belt.bend, belt.type);
        this.addChild(sprite);

        if (sprite.type !== BeltType.NORMAL) {
            this.addMask(sprite.id, sprite.getItemMask());
        }

        this._belts[sprite.id] = sprite;
    }

    /**
     * @param id {BigInt}
     */
    hideBelt(id) {
        this.children.forEach(sprite => {
            sprite.visible = sprite.id !== id
        });
    }

    /**
     * @param id {BigInt}
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
}

export class BeltSprite extends Sprite {
    constructor(id, x, y, direction, bend, type=BeltType.NORMAL) {
        super(BeltSprite.getTexture(bend, type));

        this.id = id;

        this.tileX = x;
        this.tileY = y;

        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;

        this.anchor = 0.5;
        this.angle = Direction.angle(direction);
        this.direction = direction;
        this.bend = bend;
        this.type = type;
    }

    /**
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    getItemMask() {
        if (this.type === BeltType.RAMP_UP) {
            // TODO
            return {
                x: this.x,
                y: this.y,
                width: 0,
                height: 0
            }
        } else if (this.type === BeltType.RAMP_DOWN) {
            // TODO
            return {
                x: this.x,
                y: this.y,
                width: 0,
                height: 0
            }
        }

        return {
            x: this.x - 32,
            y: this.y - 32,
            width: TILE_SIZE,
            height: TILE_SIZE
        }
    }


    set ghost(value) {
        if (value === true) {
            this.texture = BeltSprite.getGhostTexture(this.bend, this.type);
            this.alpha = 0.4;
            this.tint = 0xC8F902;
        } else {
            debugger
        }
    }

    update(x, y, direction, bend) {
        this.direction = direction
        this.angle = Direction.angle(direction);

        this.bend = bend;
        this.texture = BeltSprite.getTexture(bend, this.type);

        this.tileX = x;
        this.tileY = y;

        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;
    }

    /**
     * @param bend {BeltBend}
     * @param type {BeltType}
     * @returns {any}
     */
    static getTexture(bend, type) {
        if (type === BeltType.NORMAL) {
            switch (bend) {
                case BeltBend.LEFT:
                    return Assets.get(GameTextures.BELT_LEFT)
                case BeltBend.RIGHT:
                    return Assets.get(GameTextures.BELT_RIGHT)
                case BeltBend.STRAIGHT:
                    return Assets.get(GameTextures.BELT_STRAIGHT)
            }
        } else if (type === BeltType.RAMP_UP) {
            return Assets.get(GameTextures.BELT_RAMP_UP);
        } else if (type === BeltType.RAMP_DOWN) {
            return Assets.get(GameTextures.BELT_RAMP_DOWN);
        } else if (type === BeltType.UNDERGROUND) {
            return Texture.EMPTY;
        }

        debugger
    }

    static getGhostTexture(bend, type) {
        return BeltSprite.getTexture(bend, type);
    }
}


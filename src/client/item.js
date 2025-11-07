import {Container, Sprite} from "pixi.js";
import {BeltType, Direction, ItemFlag, ItemType} from "@/backend/constants.js";
import ClientState from "@/client/ClientState.js";
import {TILE_SIZE} from "@/constants.js";
import {CircleTexture} from "@/client/ClientRenderer.js";

export class ItemContainer extends Container {

    constructor(itemMask) {
        super();

        this.undergroundContainer = new Container();

        this.undergroundContainer.setMask({
            mask: itemMask,
            inverse: true,
        });
        this.addChild(this.undergroundContainer);

        this._items = {};
    }

    tick(ticker) {
        Object.values(this._items).forEach(item => {
            item.tick(ticker);
        });
    }

    /**
     * @param id {BigInt}
     */
    removeItem(id) {
        const item = this._items[id]
        if (item === undefined) {
            return
        }

        item.destroy();
        this.removeChild(item);
        delete this._items[id];
    }

    /**
     * @param path {BeltPath}
     */
    drawBeltPathItems(path) {
        let cursor = 0;

        path.items.forEach(item => {

            if (item.type !== ItemType.GAP) {
                /**
                 * @type {Belt}
                 */
                const belt = ClientState.belts[path.parts[Math.ceil(cursor/2)]];
                const isHalfTile = cursor % 2 === 1;

                if (belt === undefined) {
                    return
                }
                let sprite = this._items[item.id];

                if (sprite === undefined) {

                    if (item.flag === ItemFlag.STASHED) {
                        sprite = new ItemSprite(item.id, belt.x, belt.y, item.type, isHalfTile, belt.direction);
                    } else {
                        sprite = new ItemSprite(item.id, belt.inputX, belt.inputY, item.type, isHalfTile, belt.direction);
                        sprite.moveItem(belt.x, belt.y, isHalfTile, belt.direction);
                    }

                    if (BeltType.isUnderground(belt.type)) {
                        this.undergroundContainer.addChild(sprite)
                    } else {
                        this.addChild(sprite);
                    }

                    this._items[item.id] = sprite;
                } else {
                    sprite.moveItem(belt.x, belt.y, isHalfTile, belt.direction);

                    if (BeltType.isUnderground(belt.type)) {
                        if (!this.undergroundContainer.children.includes(sprite)) {
                            this.removeChild(sprite);
                            this.undergroundContainer.addChild(sprite);
                        }
                    } else {
                        if (!this.children.includes(sprite)) {
                            this.undergroundContainer.removeChild(sprite);
                            this.addChild(sprite);
                        }
                    }
                }
            }

            cursor += item.length;
        });
    }

}

class ItemSprite extends Sprite {

    /**
     * @param id {BigInt}
     * @param x {Number}
     * @param y {Number}
     * @param type {ItemType}
     * @param halfTile {boolean}
     * @param direction {Direction}
     */
    constructor(id, x, y, type, halfTile, direction) {
        super(ItemSprite.getTexture(type));

        this.id = id;
        this.tileX = x;
        this.tileY = y;

        this.x = x * TILE_SIZE + ItemSprite.offsetX(halfTile, direction);
        this._startX = this.x;
        this._endX = this.x;
        this.y = y * TILE_SIZE + ItemSprite.offsetY(halfTile, direction);
        this._startY = this.y;
        this._endY = this.y;

        this.anchor = 0.5;
    }

    static offsetX(halfTile, direction) {
        if (!halfTile) {
            return TILE_SIZE/2;
        }

        if (direction === Direction.UP) {
            return TILE_SIZE/2;
        } else if (direction === Direction.RIGHT) {
            return TILE_SIZE;
        } else if (direction === Direction.DOWN) {
            return TILE_SIZE/2;
        } else if (direction === Direction.LEFT) {
            return 0;
        }
    }

    static offsetY(halfTile, direction) {
        if (!halfTile) {
            return TILE_SIZE/2;
        }

        if (direction === Direction.UP) {
            return 0;
        } else if (direction === Direction.RIGHT) {
            return TILE_SIZE/2;
        } else if (direction === Direction.DOWN) {
            return TILE_SIZE;
        } else if (direction === Direction.LEFT) {
            return TILE_SIZE/2;
        }
    }

    tick(ticker) {
        if (this._endX == null) {
            return;
        }

        if (this.x === this._endX && this.y === this._endY) {
            this._endX = null;
            this._endY = null;
            return;
        }

        this._moveCursor += ticker.deltaMS;
        const percent = Math.min(this._moveCursor / this._moveDuration, 1);

        // Linear interpolation
        this.x = this._startX + percent * (this._endX - this._startX);
        this.y = this._startY + percent * (this._endY - this._startY);
    }

    static getTexture(type) {
        return CircleTexture;
    }

    /**
     * @param x {Number}
     * @param y {Number}
     * @param halfTile {boolean}
     * @param direction {Direction}
     */
    moveItem(x, y, halfTile, direction) {
        this.tileX = x;
        this.tileY = y;

        if (this._endX !== null && this._moveCursor > 0 && (this.x !== this._endX || this.y !== this._endY)) {
            this.x = this._endX;
            this.y = this._endY;
        }

        this._startX = this.x;
        this._endX = x * TILE_SIZE + ItemSprite.offsetX(halfTile, direction);
        this._startY = this.y;
        this._endY = y * TILE_SIZE + ItemSprite.offsetY(halfTile, direction);

        this._moveDuration = 180;
        this._moveCursor = 0;
    }
}

import {Assets, Container, Sprite} from "pixi.js";
import {Direction} from "@/backend/constants.js";
import {TILE_SIZE} from "@/constants.js";
import {GameTextures} from "@/client/ClientRenderer.js";
import {RS} from "@/backend/ruleset.js";

export class ObjectContainer extends Container {
    constructor() {
        super();

        this._objects = {};
        Object.keys(RS.definitions).forEach(name => this._objects[name] = {});
    }

    tick(ticker) {
        Object.values(this._objects).forEach(sprites => sprites.forEach(sprite =>
           sprite.tick(ticker)
        ));
    }

    addObject(name, attrs) {
        const sprite = new _ObjectSprites[name](attrs);
        this._objects[name][sprite.id] = sprite;
        this.addChild(sprite);
    }

    removeObject(name, id) {
        const sprite = this._objects[name][id]
        if (sprite === undefined) {
            return;
        }

        sprite.destroy();
        this.removeChild(sprite);
        delete this._objects[name][id];
    }
}

export class ObjectSprite extends Sprite {
    constructor(texture) {
        super(texture);
    }

    static getTexture(name) {
        return Assets.get(name)
    }

    static getGhostTexture(name) {
        return this.getTexture(name);
    }

    set ghost(value) {
        if (value === true) {
            this.texture = ObjectSprite.getGhostTexture(this._name);
            this.alpha = 0.4;
            this.tint = 0xC8F902;
        } else {
            debugger
        }
    }

    tick(ticker) {

    }

    update(x, y, direction) {
        this.direction = direction
        this.angle = Direction.angle(direction);

        this.tileX = x;
        this.tileY = y;

        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;
    }
}

export class SplitterSprite extends ObjectSprite {

    constructor({id, x, y, direction}) {
        super(ObjectSprite.getTexture(GameTextures.Splitter));
        this._name = "Splitter"

        this.id = id;

        this.tileX = x;
        this.tileY = y;

        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;

        this.anchor = {x: 0.25, y: 0.50};
        this.angle = Direction.angle(direction);
        this.direction = direction;
    }
}

export const _ObjectSprites = {
    Splitter: SplitterSprite
}

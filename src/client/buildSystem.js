import Keyboard from "@/keyboard.js";
import {freezeViewport, unfreezeViewport} from "@/viewport.js";
import {Container} from "pixi.js";
import Mouse from "@/mouse.js";
import {BeltBend, BeltType, Direction, GameObject, MAX_UNDERGROUND_LENGTH} from "@/backend/constants.js";
import ClientState, {Belt} from "@/client/ClientState.js";
import {BeltSprite} from "@/client/belt.js";
import {_ObjectSprites} from "@/client/object.js";

class BuildSystem {

    constructor() {
        this._app = null;
        this._viewport = null;
        this._backend = null;

        this.building = false;
        this._preview = null;
    }

    /**
     * @param app
     * @param viewport
     * @param backend {GameBackend}
     */
    init(app, viewport, backend) {

        this._viewport = viewport;
        this._app = app;
        this._backend = backend

        this._viewport.on("mouseleave", event => this._handleMouseLeave(event));
        this._viewport.on("pointermove", event => this._handlePointerMove(event));

        this._container = new Container();
        this._viewport.addChild(this._container);

        /**
         * @type {GameObject}
         */
        this._gameObject = null;
        this._ghost = null;
        this._direction = Direction.RIGHT;

        Keyboard.on("q", () => {
            this.endBuild();
        });

        Keyboard.on("1", () => {
            this.startBuild(GameObject.BELT);
        });

        Keyboard.on("2", () => {
            this.startBuild(GameObject.RAMP_DOWN);
        });

        Keyboard.on("3", () => {
            this.startBuild(GameObject.RAMP_UP);
        });

        Keyboard.on("4", () => {
            this.startBuild(GameObject.Splitter);
        });

        Keyboard.on("r", () => {
            if (!this.building) {
                return;
            }

            if (this._direction === Direction.UP) {
                this._direction = Direction.RIGHT;
            } else if (this._direction === Direction.RIGHT) {
                this._direction = Direction.DOWN;
            } else if (this._direction === Direction.DOWN) {
                this._direction = Direction.LEFT;
            } else {
                this._direction = Direction.UP;
            }
            this.updateGhost();
        });

        Mouse.onTileDrag((x1, y1, x2, y2) => {
            if (!this.building) {
                return;
            }

            if (this._gameObject === GameObject.BELT) {
                this._beltTileDrag(x1, y1, x2, y2);
            }
        });

        Mouse.onClick((x, y) => {
            this._handleClick(x, y);
        })
    }

    /**
     * @param x1 {Number}
     * @param y1 {Number}
     * @param x2 {Number}
     * @param y2 {Number}
     * @private
     */
    _beltTileDrag(x1, y1, x2, y2) {
        let direction;
        if (x2 === x1 && y2 < y1) {
            direction = Direction.UP;
        } else if (x2 > x1 && y2 === y1) {
            direction = Direction.RIGHT;
        } else if (x2 === x1 && y2 > y1) {
            direction = Direction.DOWN;
        } else {
            direction = Direction.LEFT;
        }

        this._direction = direction;

        const belt1 = ClientState.getBelt(x1, y1);
        if (belt1 && belt1.type !== BeltType.UNDERGROUND) {
            this._backend.removeGameObject(GameObject.BELT, belt1.id);
        }
        this._backend.createGameObject(GameObject.BELT, {
            x: x1,
            y: y1,
            direction: direction
        });


        const belt2 = ClientState.getBelt(x2, y2);
        if (belt2 && belt2.type !== BeltType.UNDERGROUND) {
            this._backend.removeGameObject(GameObject.BELT, belt2.id);
        }
        this._backend.createGameObject(GameObject.BELT, {
            x: x2,
            y: y2,
            direction: direction
        });
    }

    _handleMouseLeave() {
        if (!this.building) {
            return;
        }
    }

    _handleClick(x, y) {
        if (!this.building) {
            return;
        }

        const belt = ClientState.getBelt(x, y);
        if (belt && belt.type !== BeltType.UNDERGROUND) {
            this._backend.removeGameObject(GameObject.BELT, belt.id);
        }

        let rampParent = undefined;
        let existingRampChild = undefined;
        if (this._gameObject === GameObject.RAMP_UP || this._gameObject === GameObject.RAMP_DOWN) {
            const {parent, child} = ClientState.findRampParent(
                x,
                y,
                this._direction,
                this._gameObject === GameObject.RAMP_UP
                ? BeltType.RAMP_UP
                : BeltType.RAMP_DOWN
            );

            if (parent) {
                rampParent = parent.id;
            }
            if (child) {
                existingRampChild = child.id;
            }
        }

        this._backend.createGameObject(this._gameObject, {
            x: x,
            y: y,
            direction: this._direction,
            rampParent: rampParent,
            disconnectRampChild: existingRampChild
        });

        if (!rampParent && this._gameObject === GameObject.RAMP_UP) {
            this.startBuild(GameObject.RAMP_DOWN);
        } else if (!rampParent && this._gameObject === GameObject.RAMP_DOWN) {
            this.startBuild(GameObject.RAMP_UP);
        } else if (rampParent) {
            this.endBuild();
        }
    }

    _handlePointerMove(event) {
        if (!this.building) {
            return;
        }

        this.updateGhost();
    }

    updateGhost() {
        const x = Mouse.tileX;
        const y = Mouse.tileY;

        const belt = ClientState.getBelt(x, y);
        if (belt && belt.direction === this._direction && belt.type !== BeltType.UNDERGROUND) {
            this._ghost.visible = false;
            ClientState.renderer.hideBelt(null);
        } else {
            ClientState.renderer.hideBelt(belt ? belt.id : null);
            this._ghost.visible = true;
        }

        const parentBelt = ClientState.getBeltParent(x, y, this._direction);

        let bend = BeltBend.STRAIGHT;
        if (parentBelt !== null) {
            bend = Belt.getBend(this._direction, x, y, parentBelt.x, parentBelt.y);
        }

        this._ghost.update(x, y, this._direction, bend);

        const {parent} = ClientState.findRampParent(
            Mouse.tileX,
            Mouse.tileY,
            this._direction,
            this._gameObject === GameObject.RAMP_UP
                ? BeltType.RAMP_UP
                : this._gameObject === GameObject.RAMP_DOWN
                    ? BeltType.RAMP_DOWN
                    : BeltType.NORMAL
        );
        if (parent && this._gameObject === GameObject.RAMP_UP) {
            ClientState.renderer.highlightUndergroundBelt(parent.x, parent.y, x, y);
        } else if (parent && this._gameObject === GameObject.RAMP_DOWN) {
            ClientState.renderer.highlightUndergroundBelt(x, y, parent.x, parent.y);
        } else {
            ClientState.renderer.clearHighlights();
        }
    }

    /**
     * @param objectType {GameObject}
     */
    startBuild(objectType) {

        if (this.building && objectType === this._gameObject) {
            return;
        } else if (this.building) {
            this.endBuild();
        }

        this._gameObject = objectType;
        freezeViewport(this._viewport);

        switch (objectType) {
            case GameObject.BELT: {
                this._ghost = new BeltSprite(0, Mouse.tileX, Mouse.tileY, this._direction, BeltBend.STRAIGHT);
                this._ghost.ghost = true;
                break;
            }
            case GameObject.RAMP_UP: {
                this._ghost = new BeltSprite(0, Mouse.tileX, Mouse.tileY, this._direction, BeltBend.STRAIGHT, BeltType.RAMP_UP);
                this._ghost.ghost = true;
                break
            }
            case GameObject.RAMP_DOWN: {
                this._ghost = new BeltSprite(0, Mouse.tileX, Mouse.tileY, this._direction, BeltBend.STRAIGHT, BeltType.RAMP_DOWN);
                this._ghost.ghost = true;
                break
            }
            default:
                this._ghost = new _ObjectSprites[objectType]({id: 0, x: Mouse.tileX, y: Mouse.tileY, direction: this._direction});
                this._ghost.ghost = true;
        }

        this._container.addChild(this._ghost);
        this.updateGhost();
        this.building = true;
    }

    endBuild() {

        if (!this.building) {
            return;
        }

        ClientState.renderer.hideBelt(null);
        ClientState.renderer.clearHighlights();

        this._container.children.forEach(child => {
            child.destroy();
            this._container.removeChild(child);
            this._ghost = null;
        });

        this.building = false;
        this._gameObject = null;
        unfreezeViewport(this._viewport);
    }
}

export default new BuildSystem();
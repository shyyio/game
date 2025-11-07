import {Container, Graphics} from "pixi.js";
import {drawLine, drawRect} from "@/pixiUtils.js";
import {TILE_SIZE} from "@/constants.js";
import ClientState from "@/client/ClientState.js";
import Mouse from "@/mouse.js";
import {BeltType} from "@/backend/constants.js";
import BuildSystem from "@/client/buildSystem.js";

export class OverlayContainer extends Container {
    constructor() {
        super();

        this._highlights = [];
    }

    set lowRes(value) {
        this.visible = !value;
    }

    tick(ticker) {

        if (!this.visible) {
            return
        }

        if (!BuildSystem.building) {
            const x = Mouse.tileX;
            const y = Mouse.tileY;

            const belt = ClientState.getBelt(x, y);
            if (!belt) {
                this.clearHighlights();
                return;
            }

            if (belt.type === BeltType.RAMP_DOWN || belt.type === BeltType.RAMP_UP) {
                const {parent} = ClientState.findRampParent(belt.x, belt.y, belt.direction, belt.type);

                if (!parent) {
                    this.clearHighlights();
                    return;
                }

                if (belt.type === BeltType.RAMP_DOWN) {
                    this.highlightUndergroundBelt(belt.x, belt.y, parent.x, parent.y);
                } else {
                    this.highlightUndergroundBelt(parent.x, parent.y, belt.x, belt.y);
                }
            } else {
                this.clearHighlights();
            }
        }
    }

    highlightUndergroundBelt(x1, y1, x2, y2) {

        this.clearHighlights();

        const g = new Graphics();

        drawLine(g, x1 * TILE_SIZE + 32, y1 * TILE_SIZE + 32, x2 * TILE_SIZE + 32, y2 * TILE_SIZE + 32, 0xD5B60A);

        const belt1 = ClientState.getBelt(x1, y1)
        if (belt1 && belt1.type !== BeltType.UNDERGROUND) {
            drawRect(g, x1 * TILE_SIZE, y1 * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0xD5B60A);
        }

        const belt2 = ClientState.getBelt(x2, y2);
        if (belt2 && belt2.type !== BeltType.UNDERGROUND) {
            drawRect(g, x2 * TILE_SIZE, y2 * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0xD5B60A);
        }

        this.addChild(g);
        this._highlights.push(g);
    }

    clearHighlights() {
        this._highlights.forEach(sprite => {
            sprite.destroy();
            this.removeChild(sprite);
        });
        this._highlights.splice(0);
    }
}
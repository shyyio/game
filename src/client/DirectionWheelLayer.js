
import {Container, Graphics} from "pixi.js";
import {Direction} from "@/common/constants.js";

const WHEEL_RADIUS = 72;
const DEAD_ZONE = 22;
const ARROW_SIZE = 16;
const ARROW_INSET = 20;

/**
 * A radial direction picker, opened on long-press (or right-click) while a tool
 * is active. Screen-space sibling of {@link MiniMenuLayer}; lives on the Pixi
 * stage. It is modal: a full-screen catcher sits behind the wheel so any tap off
 * the four ring quadrants (including the dead-zone centre) just closes it, and no
 * tap/drag reaches the game underneath while it is open. Tapping a quadrant
 * resolves to a cardinal Direction and hands it to the tool via onSelect.
 * Mobile-friendly: one long-press then a tap, no keyboard.
 */
export class DirectionWheelLayer extends Container {

    constructor() {
        super();
        this._catcher = null;
        this._wheel = null;
        this.visible = false;
        this.zIndex = 1000;
    }

    /**
     * @param {number} centerScreenX
     * @param {number} centerScreenY
     * @param {function(Direction)} onSelect
     */
    open(centerScreenX, centerScreenY, onSelect) {
        this.close();

        // Full-screen catcher: any tap that isn't on a ring quadrant closes the
        // wheel and is swallowed (never reaches the game / tools beneath).
        this._catcher = new Container();
        this._catcher.eventMode = "static";
        this._catcher.hitArea = {contains: () => true};
        this._catcher.on("pointerdown", event => {
            event.nativeEvent.stopPropagation();
            this.close();
        });

        this._wheel = new Container();
        this._wheel.x = centerScreenX;
        this._wheel.y = centerScreenY;

        const bg = new Graphics();
        bg.circle(0, 0, WHEEL_RADIUS)
            .fill({color: 0x1a1a1a, alpha: 0.92})
            .stroke({color: 0x555555, width: 1});
        bg.circle(0, 0, DEAD_ZONE)
            .stroke({color: 0x555555, width: 1});
        bg.eventMode = "none";
        this._wheel.addChild(bg);

        this._addArrow(0, -(WHEEL_RADIUS - ARROW_INSET), Direction.UP);
        this._addArrow(WHEEL_RADIUS - ARROW_INSET, 0, Direction.RIGHT);
        this._addArrow(0, WHEEL_RADIUS - ARROW_INSET, Direction.DOWN);
        this._addArrow(-(WHEEL_RADIUS - ARROW_INSET), 0, Direction.LEFT);

        // Only the ring (between the dead-zone and the rim) selects; everything
        // else falls through to the catcher.
        this._wheel.eventMode = "static";
        this._wheel.hitArea = {
            contains: (x, y) => {
                const d2 = x * x + y * y;
                return d2 > DEAD_ZONE * DEAD_ZONE && d2 <= WHEEL_RADIUS * WHEEL_RADIUS;
            },
        };
        this._wheel.on("pointerdown", event => {
            event.nativeEvent.stopPropagation();
            const local = event.getLocalPosition(this._wheel);
            const direction = Direction.fromVector(local.x, local.y);
            this.close();
            onSelect(direction);
        });

        this.addChild(this._catcher);
        this.addChild(this._wheel);
        this.visible = true;
    }

    close() {
        if (this._wheel) {
            this._wheel.destroy({children: true});
            this._wheel = null;
        }
        if (this._catcher) {
            this._catcher.destroy({children: true});
            this._catcher = null;
        }
        this.visible = false;
    }

    /**
     * Draws a triangular arrow pointing away from the centre toward `direction`.
     * @private
     * @param {number} x - arrow centre, relative to the wheel centre
     * @param {number} y
     * @param {Direction} direction
     */
    _addArrow(x, y, direction) {
        const arrow = new Graphics();
        const h = ARROW_SIZE;
        const w = ARROW_SIZE;
        // Triangle pointing UP, rotated to face the direction.
        arrow.poly([0, -h / 2, w / 2, h / 2, -w / 2, h / 2]).fill({color: 0xffffff});
        arrow.angle = Direction.angle(direction);
        arrow.x = x;
        arrow.y = y;
        arrow.eventMode = "none";
        this._wheel.addChild(arrow);
    }
}

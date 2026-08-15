import {Container, Graphics, Rectangle} from "@spup/sdk/client";

// Pin shape in screen pixels (the layers counter-scale the zoom): a round head over a point.
const PIN_RADIUS = 7;
const PIN_HEAD_Y = -18;
const PIN_TIP_POINTS = [-5, -13, 5, -13, 0, 0];
const PIN_STROKE = 0xffffff;
const PIN_STROKE_WIDTH = 1.5;

// The box the pointer must be inside to count as over the pin, in the same screen pixels.
const HIT_PADDING = 3;
const PIN_HIT_AREA = new Rectangle(
    -PIN_RADIUS - HIT_PADDING,
    PIN_HEAD_Y - PIN_RADIUS - HIT_PADDING,
    (PIN_RADIUS + HIT_PADDING) * 2,
    -PIN_HEAD_Y + PIN_RADIUS + HIT_PADDING * 2,
);

const HIGHLIGHT_WIDTH = 2;
const HIGHLIGHT_OUTLINE_WIDTH = 4;
const HIGHLIGHT_PADDING = 3;

/**
 * A note's marker: a map pin whose tip sits exactly on the note's sub-tile anchor.
 */
export class NotePin extends Container {

    constructor() {
        super();
        this.hitArea = PIN_HIT_AREA;
        /**
         * The tileId this pin is currently bound to, rebound on every take from the pool.
         * @type {number|null}
         */
        this.tile = null;
        this._highlight = new Graphics();
        this.addChild(this._highlight);
        this._pin = new Graphics();
        this.addChild(this._pin);
    }

    /**
     * Whether a world point is inside the pin's marker, counter-scaled the way it is drawn. The
     * tap path needs this because touch has no hover to hit-test with.
     * @param {number} worldX
     * @param {number} worldY
     * @returns {boolean}
     */
    containsWorldPoint(worldX, worldY) {
        const scale = this.scale.x;
        const left = this.position.x + PIN_HIT_AREA.x * scale;
        const top = this.position.y + PIN_HIT_AREA.y * scale;
        return worldX >= left && worldX <= left + PIN_HIT_AREA.width * scale
            && worldY >= top && worldY <= top + PIN_HIT_AREA.height * scale;
    }

    /**
     * @param {number} color the author's stable color
     * @returns {void}
     */
    show(color) {
        this._pin
            .clear()
            .poly(PIN_TIP_POINTS)
            .fill(color)
            .stroke({color: PIN_STROKE, width: PIN_STROKE_WIDTH})
            .circle(0, PIN_HEAD_Y, PIN_RADIUS)
            .fill(color)
            .stroke({color: PIN_STROKE, width: PIN_STROKE_WIDTH});
    }

    /**
     * Rings the pin to mark it as the marker a tap would act on; null clears the ring.
     * @param {number|null} color
     * @param {number} [outlineColor] darker edge under the ring, for contrast over the world
     * @returns {void}
     */
    setHighlight(color, outlineColor) {
        this._highlight.clear();
        if (color === null) {
            return;
        }
        this._ringPath().stroke({color: outlineColor, width: HIGHLIGHT_OUTLINE_WIDTH});
        this._ringPath().stroke({color: color, width: HIGHLIGHT_WIDTH});
    }

    /**
     * @private
     * @returns {Graphics} the highlight graphics with the ring's rectangle laid down
     */
    _ringPath() {
        return this._highlight.roundRect(
            PIN_HIT_AREA.x - HIGHLIGHT_PADDING,
            PIN_HIT_AREA.y - HIGHLIGHT_PADDING,
            PIN_HIT_AREA.width + HIGHLIGHT_PADDING * 2,
            PIN_HIT_AREA.height + HIGHLIGHT_PADDING * 2,
            HIGHLIGHT_PADDING,
        );
    }
}

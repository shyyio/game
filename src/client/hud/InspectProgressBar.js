import {Container, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TINT, PROGRESS_BAR_TINT, PROGRESS_TEXT_COLOR, PROGRESS_TEXT_STROKE} from "@/client/Theme.js";
import {nineSlice} from "@/client/layers/pixiUtils.js";
import {slotFrameSprite} from "@/client/hud/slotFrame.js";
import {BUTTON_HEIGHT} from "@/client/hud/UiScale.js";

const TEXT_SIZE = 15;
const TEXT_STROKE_WIDTH = 1;
// 9-slice inset (atlas px) for the fill blocks (keeps their end caps fixed).
const BARFILL_INSET = 10;
// Inset of the fill region inside the bar frame (on-screen px = 2x the 2/2/2/1 texture-scale insets,
// since the atlas is 2x).
const FILL_INSET_LEFT = 4;
const FILL_INSET_RIGHT = 2;
const FILL_INSET_TOP = 2;
const FILL_INSET_BOTTOM = 4;

const TX_BARFILL = "ui/barfill";

/**
 * A machine's crafting progress bar. Persistent — its blocks are built once and toggled, so a
 * per-tick snapshot never rebuilds them.
 */
export class InspectProgressBar extends Container {

    /**
     * @param {TextureRegistry} textureRegistry
     * @param {number} width
     * @param {number} total - the machine's processing ticks (0 = instant, drawn as a bare frame)
     */
    constructor(
        textureRegistry,
        width,
        total,
    ) {
        super();
        // total+1 steps: idle shows 0, just-started shows 1, each elapsed tick adds one, done fills all.
        this._steps = total + 1;
        this._width = width;

        this._background = slotFrameSprite(textureRegistry, width, BUTTON_HEIGHT, PANEL_TINT);
        this.addChild(this._background);

        this._blocks = [];
        this._label = null;
        if (total > 0) {
            const usable = width - FILL_INSET_LEFT - FILL_INSET_RIGHT;
            const blockWidth = usable / this._steps;
            const fillHeight = BUTTON_HEIGHT - FILL_INSET_TOP - FILL_INSET_BOTTOM;
            for (let i = 0; i < this._steps; i++) {
                const block = nineSlice(textureRegistry, TX_BARFILL, BARFILL_INSET, BARFILL_INSET, blockWidth, fillHeight);
                block.tint = PROGRESS_BAR_TINT;
                block.x = FILL_INSET_LEFT + i * blockWidth;
                block.y = FILL_INSET_TOP;
                block.visible = false;
                this.addChild(block);
                this._blocks.push(block);
            }
            this._label = new Text({
                text: "",
                style: {
                    fontFamily: GAME_FONT,
                    fontSize: TEXT_SIZE,
                    fill: PROGRESS_TEXT_COLOR,
                    fontWeight: "bold",
                    stroke: {color: PROGRESS_TEXT_STROKE, width: TEXT_STROKE_WIDTH},
                },
            });
            this.addChild(this._label);
        }
    }

    /**
     * @param {number|null} remaining - ticks left (null = idle)
     * @param {number} total
     * @returns {void}
     */
    setProgress(remaining, total) {
        if (this._label === null) {
            return;
        }
        let filled = 0;
        if (remaining !== null) {
            filled = total - remaining + 1;
        }
        for (const [i, block] of this._blocks.entries()) {
            block.visible = i < filled;
        }
        const text = `${filled} / ${this._steps}`;
        if (text !== this._label.text) {
            this._label.text = text;
            this._centerLabel();
        }
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._background.tint = PANEL_TINT;
        for (const block of this._blocks) {
            block.tint = PROGRESS_BAR_TINT;
        }
        if (this._label !== null) {
            this._label.style.fill = PROGRESS_TEXT_COLOR;
            this._label.style.stroke = {color: PROGRESS_TEXT_STROKE, width: TEXT_STROKE_WIDTH};
        }
    }

    /**
     * @returns {void}
     * @private
     */
    _centerLabel() {
        this._label.x = (this._width - this._label.width) / 2;
        this._label.y = (BUTTON_HEIGHT - this._label.height) / 2;
    }
}

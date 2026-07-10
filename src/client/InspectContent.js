// Machine-specific inspect content (item slots + progress bar), built into a UIPanel body via
// panel.addContent(...), with (0,0) at the body's top-left corner after padding.
import {Container, Sprite, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {DEFAULT_ITEM_TEXTURE} from "@/client/ItemDrawLayer.js";
import {PANEL_TINT, PROGRESS_BAR_TINT, PROGRESS_TEXT_COLOR, PROGRESS_TEXT_STROKE} from "@/client/Theme.js";
import {addSlotHighlight} from "@/client/slotHighlight.js";
import {nineSlice} from "@/client/pixiUtils.js";

const SLOT_SIZE = 60;
const SLOT_MARGIN_Y = 10;
const SLOT_MARGIN_X = 10;
const SLOT_ITEM_INSET = 6;
export const SLOT_FRAME_INSET = 12;
// Opacity for a memory/inferred/last-produced item (vs a full-opacity port item).
const HALF_ALPHA = 0.6;

const PROGRESS_HEIGHT = 34;
const PROGRESS_TEXT_SIZE = 15;
const PROGRESS_TEXT_STROKE_WIDTH = 1;
// 9-slice inset (atlas px) for the bar background frame.
const PROGRESS_FRAME_INSET = 12;
// 9-slice inset (atlas px) for the fill blocks (keeps their end caps fixed).
const BARFILL_INSET = 10;
// Inset of the fill region inside the bar frame (on-screen px = 2x the 2/2/2/1 texture-scale insets,
// since the atlas is 2x).
const BAR_FILL_INSET_LEFT = 4;
const BAR_FILL_INSET_RIGHT = 2;
const BAR_FILL_INSET_TOP = 2;
const BAR_FILL_INSET_BOTTOM = 4;

const TX_BAR = "ui_flat/UI_Flat_Frame02a_inset4";
export const TX_SLOT = "ui_flat/UI_Flat_Frame02a_inset4";

// Total content height: inputs row, then a row sharing the progress bar and output slot.
export const INSPECT_CONTENT_HEIGHT = SLOT_SIZE + SLOT_MARGIN_Y + SLOT_SIZE;
const TX_BARFILL = "ui_flat/UI_Flat_barfill";

/**
 * Builds the machine content (inputs row, progress bar, output slot) into a UIPanel.
 * @param {UIPanel} panel
 * @param {InspectHeartbeatEvent} event
 * @param {TextureRegistry} textureRegistry
 * @param {Object<number, string>} itemTextures
 * @param {number|undefined} lastProduced - the machine's last produced item (output fallback)
 * @returns {void}
 */
export function buildInspectContent(panel, event, textureRegistry, itemTextures, lastProduced) {
    let y = 0;
    // Output slot right-aligned in the body (independent of the input columns).
    const outputX = panel.contentWidth - SLOT_SIZE;

    // Inputs: the port item at full opacity (takes precedence), else the gathered/consumed item at half.
    event.inputPorts.forEach((portItem, i) => {
        const item = portItem !== 0 ? portItem : event.inputMemory[i];
        const alpha = portItem !== 0 ? 1 : HALF_ALPHA;
        addSlot(panel, item, alpha, i * (SLOT_SIZE + SLOT_MARGIN_X), y, textureRegistry, itemTextures);
    });
    y += SLOT_SIZE + SLOT_MARGIN_Y;

    // Second row: progress bar on the left, output slot in its column on the right.
    const progressY = y + (SLOT_SIZE - PROGRESS_HEIGHT) / 2;
    addProgressBar(panel, event.processingRemaining, event.processingTotal, 0, progressY, outputX - SLOT_MARGIN_X, textureRegistry);

    // Output: out-port item at full opacity, else the inferred recipe output, else the last produced
    // item (both at half). All fall through to an empty slot.
    let outputItem = 0;
    let outputAlpha = 1;
    if (event.outputItem) {
        outputItem = event.outputItem;
    } else if (event.recipeOutput) {
        outputItem = event.recipeOutput;
        outputAlpha = HALF_ALPHA;
    } else if (lastProduced) {
        outputItem = lastProduced;
        outputAlpha = HALF_ALPHA;
    }
    addSlot(panel, outputItem, outputAlpha, outputX, y, textureRegistry, itemTextures);
}

function addSlot(panel, item, itemAlpha, x, y, textureRegistry, itemTextures) {
    const slot = new Container();
    slot.x = x;
    slot.y = y;

    const frame = nineSlice(textureRegistry, TX_SLOT, SLOT_FRAME_INSET, SLOT_FRAME_INSET, SLOT_SIZE, SLOT_SIZE);
    frame.tint = PANEL_TINT;
    slot.addChild(frame);

    // Hover highlight (no active state on inspect slots).
    addSlotHighlight(slot, SLOT_SIZE);

    if (item !== 0) {
        const icon = itemSprite(item, textureRegistry, itemTextures);
        const box = SLOT_SIZE - SLOT_ITEM_INSET * 2;
        icon.scale.set(Math.min(box / icon.texture.width, box / icon.texture.height));
        icon.x = (SLOT_SIZE - icon.width) / 2;
        icon.y = (SLOT_SIZE - icon.height) / 2;
        icon.alpha = itemAlpha;
        slot.addChild(icon);
    }
    panel.addContent(slot);
}

function itemSprite(item, textureRegistry, itemTextures) {
    const name = itemTextures[item] !== undefined ? itemTextures[item] : DEFAULT_ITEM_TEXTURE;
    return new Sprite(textureRegistry.get(name));
}

function addProgressBar(panel, remaining, total, x, y, width, textureRegistry) {
    const bg = nineSlice(textureRegistry, TX_BAR, PROGRESS_FRAME_INSET, PROGRESS_FRAME_INSET, width, PROGRESS_HEIGHT);
    bg.x = x;
    bg.y = y;
    bg.tint = PANEL_TINT;
    panel.addContent(bg);

    // total+1 steps: idle shows 0, just-started shows 1/(total+1), each elapsed tick adds one, done fills all.
    if (total > 0) {
        const steps = total + 1;
        const filled = remaining === null ? 0 : total - remaining + 1;
        const usable = width - BAR_FILL_INSET_LEFT - BAR_FILL_INSET_RIGHT;
        const blockWidth = usable / steps;
        const fillHeight = PROGRESS_HEIGHT - BAR_FILL_INSET_TOP - BAR_FILL_INSET_BOTTOM;
        const fillY = y + BAR_FILL_INSET_TOP;
        for (let i = 0; i < filled; i++) {
            const block = nineSlice(textureRegistry, TX_BARFILL, BARFILL_INSET, BARFILL_INSET, blockWidth, fillHeight);
            block.tint = PROGRESS_BAR_TINT;
            block.x = x + BAR_FILL_INSET_LEFT + i * blockWidth;
            block.y = fillY;
            panel.addContent(block);
        }

        // Progress as text, e.g. "0 / 3" (total includes the +1 step), centered on the bar.
        const label = new Text({
            text: `${filled} / ${steps}`,
            style: {
                fontFamily: GAME_FONT,
                fontSize: PROGRESS_TEXT_SIZE,
                fill: PROGRESS_TEXT_COLOR,
                fontWeight: "bold",
                stroke: {color: PROGRESS_TEXT_STROKE, width: PROGRESS_TEXT_STROKE_WIDTH},
            },
        });
        label.x = x + (width - label.width) / 2;
        label.y = y + (PROGRESS_HEIGHT - label.height) / 2;
        panel.addContent(label);
    }
}

import {Container, Graphics, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TEXT, SLOT_HIGHLIGHT_COLOR} from "@/client/Theme.js";
import {nineSlice} from "@/client/pixiUtils.js";
import {TX_SLOT, SLOT_FRAME_INSET} from "@/client/InspectContent.js";

export const BUTTON_HEIGHT = 34;
const BUTTON_PADDING_X = 16;
const HOVER_ALPHA = 0.2;

/**
 * A 9-slice HUD button sized to its label, tinted `borderColor`; tap fires onClick. Disabled
 * grays it out and drops interactivity.
 * @param {TextureRegistry} textureRegistry
 * @param {string} label
 * @param {number} borderColor
 * @param {function(): void} onClick
 * @param {boolean} [disabled]
 * @returns {Container}
 */
export function buildPanelButton(textureRegistry, label, borderColor, onClick, disabled = false) {
    const text = new Text({
        text: label,
        style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TEXT, fontWeight: "bold"},
    });
    const width = text.width + BUTTON_PADDING_X * 2;

    const button = new Container();
    const bg = nineSlice(textureRegistry, TX_SLOT, SLOT_FRAME_INSET, SLOT_FRAME_INSET, width, BUTTON_HEIGHT);
    bg.tint = borderColor;
    button.addChild(bg);

    const hover = new Graphics().rect(0, 0, width, BUTTON_HEIGHT).fill(SLOT_HIGHLIGHT_COLOR);
    hover.alpha = 0;
    button.addChild(hover);

    text.x = BUTTON_PADDING_X;
    text.y = (BUTTON_HEIGHT - text.height) / 2;
    button.addChild(text);

    if (disabled) {
        button.alpha = 0.45;
        return button;
    }
    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointerover", () => hover.alpha = HOVER_ALPHA);
    button.on("pointerout", () => hover.alpha = 0);
    button.on("pointerdown", (e) => e.stopPropagation());
    button.on("pointertap", () => onClick());
    return button;
}

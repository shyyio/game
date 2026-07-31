import {Container, Graphics, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TEXT, PANEL_HOVER_FILL} from "@/client/Theme.js";

export const BUTTON_HEIGHT = 34;
const BUTTON_PADDING_X = 16;

/**
 * A rounded, bordered HUD button sized to its label; tap fires onClick. Disabled grays it out
 * and drops interactivity.
 * @param {string} label
 * @param {number} borderColor
 * @param {function(): void} onClick
 * @param {boolean} [disabled]
 * @returns {Container}
 */
export function buildPanelButton(label, borderColor, onClick, disabled = false) {
    const text = new Text({
        text: label,
        style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TEXT, fontWeight: "bold"},
    });
    const width = text.width + BUTTON_PADDING_X * 2;

    const button = new Container();
    const fill = new Graphics()
        .roundRect(0, 0, width, BUTTON_HEIGHT, 6)
        .fill({color: PANEL_HOVER_FILL})
        .stroke({color: borderColor, width: 1});
    button.addChild(fill);

    text.x = BUTTON_PADDING_X;
    text.y = (BUTTON_HEIGHT - text.height) / 2;
    button.addChild(text);

    if (disabled) {
        button.alpha = 0.45;
        return button;
    }
    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointerover", () => fill.tint = 0xcccccc);
    button.on("pointerout", () => fill.tint = 0xffffff);
    button.on("pointerdown", (e) => e.stopPropagation());
    button.on("pointertap", () => onClick());
    return button;
}

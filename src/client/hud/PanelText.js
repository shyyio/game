import {Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TINT_TEXT} from "@/client/Theme.js";

export const TextRole = {
    HEADER: "header",
    BODY: "body",
    MUTED: "muted",
};

const TEXT_SIZE = 15;

/**
 * Built per call, not once: the palette swaps with the theme.
 * @param {string} role - a TextRole value
 * @returns {object} a pixi text style
 */
function styleFor(role) {
    if (role === TextRole.HEADER) {
        return {fontFamily: GAME_FONT, fontSize: TEXT_SIZE, fill: PANEL_TINT_TEXT, fontWeight: "bold"};
    }
    return {fontFamily: GAME_FONT, fontSize: TEXT_SIZE, fill: PANEL_TINT_TEXT};
}

/**
 * A Text styled for its panel role; MUTED additionally dims alpha.
 * @param {string} label
 * @param {string} role - a TextRole value
 * @returns {Text}
 */
export function panelText(label, role) {
    const text = new Text({text: label, style: styleFor(role)});
    if (role === TextRole.MUTED) {
        text.alpha = 0.6;
    }
    return text;
}

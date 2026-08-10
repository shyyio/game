import {Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {TOOLBAR_TEXT} from "@/client/Theme.js";

export const TextRole = {
    HEADER: "header",
    BODY: "body",
    MUTED: "muted",
};

const STYLES = {
    [TextRole.HEADER]: {fontFamily: GAME_FONT, fontSize: 15, fill: TOOLBAR_TEXT, fontWeight: "bold"},
    [TextRole.BODY]: {fontFamily: GAME_FONT, fontSize: 15, fill: TOOLBAR_TEXT},
    [TextRole.MUTED]: {fontFamily: GAME_FONT, fontSize: 15, fill: TOOLBAR_TEXT},
};

/**
 * A Text styled for its panel role; MUTED additionally dims alpha.
 * @param {string} label
 * @param {string} role - a TextRole value
 * @returns {Text}
 */
export function panelText(label, role) {
    const text = new Text({text: label, style: STYLES[role]});
    if (role === TextRole.MUTED) {
        text.alpha = 0.6;
    }
    return text;
}

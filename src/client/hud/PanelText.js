import {Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TINT_TEXT} from "@/client/Theme.js";

export const TextRole = {
    HEADER: "header",
    BODY: "body",
    MUTED: "muted",
};

const TEXT_SIZE = 15;
const ELLIPSIS = "…";

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

/**
 * A {@link panelText} trimmed to `maxWidth`, ending in an ellipsis when the label does not fit.
 * For labels that come from data (an item's name, a player's username), where the panel has a
 * fixed width and the string has no length anyone controls.
 * @param {string} label
 * @param {string} role - a TextRole value
 * @param {number} maxWidth
 * @returns {Text}
 */
export function fittedPanelText(label, role, maxWidth) {
    const text = panelText(label, role);
    if (text.width <= maxWidth) {
        return text;
    }
    // Longest prefix that fits with the ellipsis; the label is short enough that a linear walk in
    // from the end costs less than the layout churn of a binary search.
    for (let length = label.length - 1; length > 0; length -= 1) {
        text.text = `${label.slice(0, length)}${ELLIPSIS}`;
        if (text.width <= maxWidth) {
            return text;
        }
    }
    text.text = ELLIPSIS;
    if (text.width > maxWidth) {
        // Nothing at all fits; drawing the ellipsis would overrun whatever sits beside it.
        text.text = "";
    }
    return text;
}

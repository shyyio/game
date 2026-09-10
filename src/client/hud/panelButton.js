import {Container, Graphics, Sprite, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {textOn, SLOT_HIGHLIGHT_COLOR} from "@/client/Theme.js";
import {fitIcon, trackTap} from "@/client/layers/pixiUtils.js";
import {SLOT_FRAME_INSET, slotFrameSprite} from "@/client/hud/slotFrame.js";
import {BUTTON_HEIGHT} from "@/client/hud/UiScale.js";
import Mobile from "@/client/Mobile.js";

const BUTTON_PADDING_X = 16;
const HOVER_ALPHA = 0.2;
const BUTTON_FONT_SIZE = 15;
// Grays a disabled button, which also drops its interactivity.
const DISABLED_ALPHA = 0.45;

/**
 * @typedef {Object} ButtonFace
 * @property {Container} button
 * @property {Graphics} hover
 */

/**
 * A button's tinted 9-slice background and the hover wash over it, sized to `width`.
 * @param {TextureCache} textureCache
 * @param {number} width
 * @param {number} borderColor
 * @returns {ButtonFace}
 */
function buildButtonFace(textureCache, width, borderColor) {
    const button = new Container();
    button.addChild(slotFrameSprite(textureCache, width, BUTTON_HEIGHT, borderColor));

    const hover = new Graphics().rect(0, 0, width, BUTTON_HEIGHT).fill(SLOT_HIGHLIGHT_COLOR);
    hover.alpha = 0;
    button.addChild(hover);
    return {button, hover};
}

/**
 * Makes a built face respond: pointer cursor, hover wash, and a tap firing `onClick`.
 * @param {Container} button
 * @param {Graphics} hover
 * @param {function(): void} onClick
 * @returns {void}
 */
function wireButtonPress(button, hover, onClick) {
    button.cursor = "pointer";
    button.on("pointerover", () => hover.alpha = HOVER_ALPHA);
    button.on("pointerout", () => hover.alpha = 0);
    trackTap(button, onClick);
}

/**
 * A button label carrying its keyboard hint in brackets (docs/ux-conventions.md), dropped on
 * touch input; single-character keys display uppercase.
 * @param {string} label
 * @param {string} key
 * @returns {string}
 */
export function hotkeyLabel(label, key) {
    if (Mobile.enabled) {
        return label;
    }
    if (key.length === 1) {
        return `${label} [${key.toUpperCase()}]`;
    }
    return `${label} [${key}]`;
}

/**
 * A 9-slice HUD button sized to its label, tinted `borderColor`; tap fires onClick. Disabled
 * grays it out and drops interactivity.
 * @param {TextureCache} textureCache
 * @param {string} label
 * @param {number} borderColor
 * @param {function(): void} onClick
 * @param {boolean} [disabled]
 * @returns {Container}
 */
export function buildPanelButton(textureCache, label, borderColor, onClick, disabled = false) {
    const text = new Text({
        text: label,
        style: {fontFamily: GAME_FONT, fontSize: BUTTON_FONT_SIZE, fill: textOn(borderColor), fontWeight: "bold"},
    });
    const width = text.width + BUTTON_PADDING_X * 2;

    const {button, hover} = buildButtonFace(textureCache, width, borderColor);

    text.x = BUTTON_PADDING_X;
    text.y = (BUTTON_HEIGHT - text.height) / 2;
    button.addChild(text);

    if (disabled) {
        button.alpha = DISABLED_ALPHA;
        return button;
    }
    wireButtonPress(button, hover, onClick);
    return button;
}

/**
 * A square 9-slice HUD button showing a tinted icon instead of a label; tap fires onClick.
 * @param {TextureCache} textureCache
 * @param {string} iconTextureName
 * @param {number} iconTint
 * @param {number} borderColor
 * @param {function(): void} onClick
 * @returns {Container}
 */
export function buildIconButton(textureCache, iconTextureName, iconTint, borderColor, onClick) {
    const {button, hover} = buildButtonFace(textureCache, BUTTON_HEIGHT, borderColor);

    const icon = new Sprite(textureCache.get(iconTextureName));
    icon.tint = iconTint;
    fitIcon(icon, BUTTON_HEIGHT, SLOT_FRAME_INSET);
    button.addChild(icon);

    wireButtonPress(button, hover, onClick);
    return button;
}

/**
 * A horizontal row of {@link buildPanelButton} segments, one per option; the option matching
 * `current` is tinted `activeTint`, the rest `inactiveTint`; tapping one selects it via `onSelect`.
 * @param {TextureCache} textureCache
 * @param {Array<{value: *, label: string}>} options
 * @param {*} current
 * @param {function(value: *): void} onSelect
 * @param {{activeTint: number, inactiveTint: number, gap: number}} style
 * @returns {Container}
 */
export function buildToggleRow(textureCache, options, current, onSelect, {activeTint, inactiveTint, gap}) {
    const row = new Container();
    let x = 0;
    for (const {value, label} of options) {
        const tint = value === current ? activeTint : inactiveTint;
        const segment = buildPanelButton(textureCache, label, tint, () => onSelect(value));
        segment.x = x;
        row.addChild(segment);
        x += segment.width + gap;
    }
    return row;
}

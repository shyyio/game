import {Container, Graphics, Sprite, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {textOn, SLOT_HIGHLIGHT_COLOR} from "@/client/Theme.js";
import {nineSlice, trackTap} from "@/client/layers/pixiUtils.js";
import {TX_SLOT, SLOT_FRAME_INSET} from "@/client/hud/slotFrame.js";
import {BUTTON_HEIGHT} from "@/client/hud/UiScale.js";
import Mobile from "@/client/Mobile.js";

const BUTTON_PADDING_X = 16;
const HOVER_ALPHA = 0.2;

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
        style: {fontFamily: GAME_FONT, fontSize: 15, fill: textOn(borderColor), fontWeight: "bold"},
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
    button.cursor = "pointer";
    button.on("pointerover", () => hover.alpha = HOVER_ALPHA);
    button.on("pointerout", () => hover.alpha = 0);
    trackTap(button, onClick);
    return button;
}

/**
 * A square 9-slice HUD button showing a tinted icon instead of a label; tap fires onClick.
 * @param {TextureRegistry} textureRegistry
 * @param {string} iconTextureName
 * @param {number} iconTint
 * @param {number} borderColor
 * @param {function(): void} onClick
 * @returns {Container}
 */
export function buildIconButton(textureRegistry, iconTextureName, iconTint, borderColor, onClick) {
    const button = new Container();
    const bg = nineSlice(textureRegistry, TX_SLOT, SLOT_FRAME_INSET, SLOT_FRAME_INSET, BUTTON_HEIGHT, BUTTON_HEIGHT);
    bg.tint = borderColor;
    button.addChild(bg);

    const hover = new Graphics().rect(0, 0, BUTTON_HEIGHT, BUTTON_HEIGHT).fill(SLOT_HIGHLIGHT_COLOR);
    hover.alpha = 0;
    button.addChild(hover);

    const icon = new Sprite(textureRegistry.get(iconTextureName));
    icon.tint = iconTint;
    const box = BUTTON_HEIGHT - SLOT_FRAME_INSET * 2;
    icon.scale.set(Math.min(box / icon.texture.width, box / icon.texture.height));
    icon.x = (BUTTON_HEIGHT - icon.width) / 2;
    icon.y = (BUTTON_HEIGHT - icon.height) / 2;
    button.addChild(icon);

    button.cursor = "pointer";
    button.on("pointerover", () => hover.alpha = HOVER_ALPHA);
    button.on("pointerout", () => hover.alpha = 0);
    trackTap(button, onClick);
    return button;
}

/**
 * A horizontal row of {@link buildPanelButton} segments, one per option; the option matching
 * `current` is tinted `activeTint`, the rest `inactiveTint`; tapping one selects it via `onSelect`.
 * @param {TextureRegistry} textureRegistry
 * @param {Array<{value: *, label: string}>} options
 * @param {*} current
 * @param {function(value: *): void} onSelect
 * @param {{activeTint: number, inactiveTint: number, gap: number}} style
 * @returns {Container}
 */
export function buildToggleRow(textureRegistry, options, current, onSelect, {activeTint, inactiveTint, gap}) {
    const row = new Container();
    let x = 0;
    for (const {value, label} of options) {
        const tint = value === current ? activeTint : inactiveTint;
        const segment = buildPanelButton(textureRegistry, label, tint, () => onSelect(value));
        segment.x = x;
        row.addChild(segment);
        x += segment.width + gap;
    }
    return row;
}

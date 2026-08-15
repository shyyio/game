// WCAG 2.1 contrast math over 0xRRGGBB colors, for auditing HUD text against what it sits on.

// AA thresholds: normal text, and "large" text (18pt / 14pt bold, i.e. 24px / 18.66px at 96dpi).
const AA_NORMAL_RATIO = 4.5;
const AA_LARGE_RATIO = 3;
const LARGE_SIZE = 24;
const LARGE_BOLD_SIZE = 18.66;

/**
 * @param {number} color
 * @returns {{r: number, g: number, b: number}} 0-255 channels
 */
export function channels(color) {
    return {r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff};
}

/**
 * @param {{r: number, g: number, b: number}} parts - 0-255 channels, rounded and clamped
 * @returns {number}
 */
export function color(parts) {
    const clamp = value => Math.min(255, Math.max(0, Math.round(value)));
    return (clamp(parts.r) << 16) | (clamp(parts.g) << 8) | clamp(parts.b);
}

/**
 * A texture pixel under a pixi tint, which multiplies per channel.
 * @param {number} pixel
 * @param {number} tint
 * @returns {number}
 */
export function tinted(pixel, tint) {
    const a = channels(pixel);
    const b = channels(tint);
    return color({r: a.r * b.r / 255, g: a.g * b.g / 255, b: a.b * b.b / 255});
}

/**
 * `top` drawn at `alpha` over `bottom`.
 * @param {number} top
 * @param {number} alpha - 0-1
 * @param {number} bottom
 * @returns {number}
 */
export function composited(top, alpha, bottom) {
    const a = channels(top);
    const b = channels(bottom);
    return color({
        r: a.r * alpha + b.r * (1 - alpha),
        g: a.g * alpha + b.g * (1 - alpha),
        b: a.b * alpha + b.b * (1 - alpha),
    });
}

/**
 * @param {number} value - one 0-255 channel
 * @returns {number} its linearized value
 */
function linearize(value) {
    const scaled = value / 255;
    if (scaled <= 0.04045) {
        return scaled / 12.92;
    }
    return ((scaled + 0.055) / 1.055) ** 2.4;
}

/**
 * @param {number} value
 * @returns {number} WCAG relative luminance, 0 (black) to 1 (white)
 */
export function relativeLuminance(value) {
    const {r, g, b} = channels(value);
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number} their WCAG contrast ratio, 1 (identical) to 21 (black on white)
 */
export function contrastRatio(a, b) {
    const first = relativeLuminance(a);
    const second = relativeLuminance(b);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * @param {number} fontSize - px
 * @param {boolean} bold
 * @returns {number} the ratio AA demands of text that size
 */
export function requiredRatio(fontSize, bold) {
    if (fontSize >= LARGE_SIZE) {
        return AA_LARGE_RATIO;
    }
    if (bold && fontSize >= LARGE_BOLD_SIZE) {
        return AA_LARGE_RATIO;
    }
    return AA_NORMAL_RATIO;
}

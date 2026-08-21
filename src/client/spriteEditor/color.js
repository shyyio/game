// HSL <-> hex conversions for the editor's color picker. h in [0, 360), s and l in [0, 100].

/**
 * @param {string} hex "#rrggbb"
 * @returns {{h: number, s: number, l: number}}
 */
export function hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const delta = max - min;
    let h = 0;
    let s = 0;
    if (delta !== 0) {
        s = delta / (1 - Math.abs(2 * l - 1));
        if (max === r) {
            h = ((g - b) / delta) % 6;
        } else if (max === g) {
            h = (b - r) / delta + 2;
        } else {
            h = (r - g) / delta + 4;
        }
        h *= 60;
        if (h < 0) {
            h += 360;
        }
    }
    return {h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100)};
}

/**
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {string} "#rrggbb"
 */
export function hslToHex(h, s, l) {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = light - c / 2;
    let rgb;
    if (h < 60) {
        rgb = [c, x, 0];
    } else if (h < 120) {
        rgb = [x, c, 0];
    } else if (h < 180) {
        rgb = [0, c, x];
    } else if (h < 240) {
        rgb = [0, x, c];
    } else if (h < 300) {
        rgb = [x, 0, c];
    } else {
        rgb = [c, 0, x];
    }
    return "#" + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

import {Container, Graphics, Text, TextStyle} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {DisplayPool} from "@/client/layers/DisplayPool.js";
import {GAME_FONT, TILE_SIZE} from "@/client/constants.js";
import ReducedMotion from "@/client/ReducedMotion.js";

// Splat text: bold, outlined black so it reads over any terrain, white so a per-splat tint carries
// the color. One style for every splat, so pixi caches one texture per distinct string.
const HITSPLAT_TEXT_STYLE = new TextStyle({
    fontFamily: GAME_FONT,
    fontSize: 28,
    fontWeight: "bold",
    fill: 0xffffff,
    stroke: {
        color: 0x000000,
        width: 5,
        join: "round",
        cap: "round",
    },
});

// A splat's life: it climbs this far over this long, opaque until the fade point.
export const HITSPLAT_DURATION_MS = 900;
export const HITSPLAT_RISE = TILE_SIZE * 0.9;
const HITSPLAT_FADE_START = 0.55;

// Splats alive at once; a burst past this drops its oldest, so the newest numbers are the ones
// on screen.
const HITSPLAT_MAX_LIVE = 256;

// A gap between ticks longer than this means the renderer is stalled (a hidden tab stops
// requestAnimationFrame), so splats spawned in it would all play at once on the next frame.
export const HITSPLAT_STALL_MS = 250;

// The box a splat's trailing icon is scaled into, the gap between it and the text, and the stroke
// its painter draws with; a painter draws around (0, 0) at whatever size it likes.
export const HITSPLAT_ICON_SIZE = 20;
const HITSPLAT_ICON_GAP = 4;
const HITSPLAT_ICON_STROKE = 2;

/**
 * Floating combat text over the world: short runs of text that rise off a tile and fade.
 * A splat is fire-and-forget, so callers get no handle back.
 */
export class HitsplatLayer extends AbstractDrawLayer {

    constructor() {
        super();
        /**
         * Splat sprites, pooled: a played-out splat is parked and re-shown rather than rebuilt.
         * @type {DisplayPool}
         * @private
         */
        this._sprites = new DisplayPool(
            (text, color, drawIcon, iconColor) => {
                const sprite = new HitsplatSprite();
                sprite.show(text, color, drawIcon, iconColor);
                this.addChild(sprite);
                return sprite;
            },
            sprite => {
                sprite.visible = false;
            },
            (sprite, text, color, drawIcon, iconColor) => {
                sprite.show(text, color, drawIcon, iconColor);
                sprite.visible = true;
            },
        );
        /**
         * Splats on screen, oldest first; they share one duration, so the played-out ones are
         * always a prefix.
         * @type {HitsplatSprite[]}
         * @private
         */
        this._live = [];
        this._lastTickMs = performance.now();
    }

    get layerIndex() {
        // Above the mod overlays (100), below the placement ghosts (200).
        return 150;
    }

    /**
     * Floats a line of text off a tile.
     * @param {Object} splat
     * @param {number} splat.tileX - tile coordinate, fractions allowed
     * @param {number} splat.tileY
     * @param {string} splat.text
     * @param {number} splat.color - the text's tint; the outline stays black
     * @param {number} [splat.jitter] - random spread from the tile center, in tiles
     * @param {function(Graphics, number, number): void} [splat.drawIcon] - an icons.js glyph
     *     painter, trailing the text
     * @param {number} [splat.iconColor] - the color the painter draws in
     * @returns {void}
     */
    drawHitsplat({tileX, tileY, text, color, jitter=0, drawIcon=null, iconColor=0}) {
        // Nobody is watching a stalled renderer, and a splat says nothing once it is late.
        if (isRenderStalled(performance.now() - this._lastTickMs)) {
            return;
        }
        // The overworld hides this layer, so a splat spawned there is measured and drawn for nobody.
        if (!this.visible) {
            return;
        }
        if (this._live.length >= HITSPLAT_MAX_LIVE) {
            this._sprites.release(this._live.shift());
        }
        const sprite = this._sprites.acquire(text, color, drawIcon, iconColor);
        sprite.baseY = (tileY + 0.5 + hitsplatJitterOffset(jitter, Math.random())) * TILE_SIZE;
        sprite.elapsedMS = 0;
        sprite.alpha = 1;
        sprite.x = (tileX + 0.5 + hitsplatJitterOffset(jitter, Math.random())) * TILE_SIZE - sprite.runWidth / 2;
        sprite.y = sprite.baseY;
        this._live.push(sprite);
    }

    /**
     * Advances every splat's rise and fade, dropping the ones that have played out.
     * @param {number} frame unused - splats move, they don't cycle frames
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks unused - splats are short-lived, not chunk-mounted
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        this._lastTickMs = performance.now();
        let expired = 0;
        for (const sprite of this._live) {
            sprite.elapsedMS += deltaMS;
            const progress = sprite.elapsedMS / HITSPLAT_DURATION_MS;
            if (progress >= 1) {
                this._sprites.release(sprite);
                expired += 1;
            } else {
                // Reduced motion keeps the splat on its tile; it still fades out on time.
                if (ReducedMotion.isEnabled) {
                    sprite.y = sprite.baseY;
                } else {
                    sprite.y = sprite.baseY + hitsplatOffsetY(progress);
                }
                sprite.alpha = hitsplatAlpha(progress);
            }
        }
        if (expired > 0) {
            this._live.splice(0, expired);
        }
    }
}

/**
 * One splat on screen: its text, its optional trailing icon, and how far into its life it is.
 */
class HitsplatSprite extends Container {

    constructor() {
        super();
        this._text = new Text({text: "", style: HITSPLAT_TEXT_STYLE});
        this._icon = new Graphics();
        this.addChild(this._text);
        this.addChild(this._icon);
        // World pixels this splat's run sits at before the rise, its age, and the run's width.
        this.baseY = 0;
        this.elapsedMS = 0;
        this.runWidth = 0;
    }

    /**
     * Lays a run out from this sprite's origin: text first, icon trailing it scaled into its box.
     * @param {string} text
     * @param {number} color - the text's tint
     * @param {function(Graphics, number, number): void|null} drawIcon
     * @param {number} iconColor
     * @returns {void}
     */
    show(text, color, drawIcon, iconColor) {
        this._text.text = text;
        this._text.tint = color;
        this._icon.clear();
        if (drawIcon === null) {
            this._icon.visible = false;
        } else {
            this._icon.visible = true;
            this._icon.scale = 1;
            drawIcon(this._icon, iconColor, HITSPLAT_ICON_STROKE);
            this._icon.scale = HITSPLAT_ICON_SIZE / this._icon.width;
            this._icon.x = this._text.width + HITSPLAT_ICON_GAP + HITSPLAT_ICON_SIZE / 2;
            this._icon.y = this._text.height / 2;
        }
        this.runWidth = hitsplatRunWidth(this._text.width, this._icon.visible);
    }
}

/**
 * Whether the renderer has stopped drawing frames, rather than merely running slow.
 * @param {number} msSinceTick - wall-clock ms since the last frame
 * @returns {boolean}
 */
export function isRenderStalled(msSinceTick) {
    return msSinceTick > HITSPLAT_STALL_MS;
}

/**
 * How far a splat has climbed, in world pixels (negative: up).
 * @param {number} progress - elapsed fraction of the splat's life, in [0, 1]
 * @returns {number}
 */
export function hitsplatOffsetY(progress) {
    return -HITSPLAT_RISE * progress;
}

/**
 * A splat's opacity: solid until the fade point, then out by the end.
 * @param {number} progress - elapsed fraction of the splat's life, in [0, 1]
 * @returns {number}
 */
export function hitsplatAlpha(progress) {
    if (progress < HITSPLAT_FADE_START) {
        return 1;
    }
    return (1 - progress) / (1 - HITSPLAT_FADE_START);
}

/**
 * A spawn's offset from the tile center along one axis, in tiles.
 * @param {number} jitter - spread radius in tiles
 * @param {number} random - a value in [0, 1)
 * @returns {number}
 */
export function hitsplatJitterOffset(jitter, random) {
    return (random * 2 - 1) * jitter;
}

/**
 * The width a whole run occupies, in world pixels: its text, plus the trailing icon's gap and box.
 * @param {number} textWidth - the run's text width in world pixels
 * @param {boolean} hasIcon
 * @returns {number}
 */
export function hitsplatRunWidth(textWidth, hasIcon) {
    if (hasIcon) {
        return textWidth + HITSPLAT_ICON_GAP + HITSPLAT_ICON_SIZE;
    }
    return textWidth;
}

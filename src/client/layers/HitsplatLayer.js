import {BitmapFontManager, Particle, ParticleContainer} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {DisplayPool} from "@/client/layers/DisplayPool.js";
import {GAME_FONT, TILE_SIZE} from "@/client/constants.js";
import ReducedMotion from "@/client/ReducedMotion.js";

// The installed glyph font: its name, the size splats render at, and everything one can say.
// The character set stays small enough to bake onto a single atlas page, which is what lets
// every splat on screen batch as one draw.
const HITSPLAT_FONT = "Hitsplat";
const HITSPLAT_FONT_SIZE = 28;
const HITSPLAT_CHARS = "0123456789+-.,%xkM ";

// Glyphs are baked white so a splat's color is a tint; the outline is baked pure black, which
// any tint leaves black.
const HITSPLAT_FILL = 0xffffff;
const HITSPLAT_OUTLINE = 0x000000;
const HITSPLAT_OUTLINE_WIDTH = 5;

// Sharper than 1:1 so a splat holds up zoomed in.
const HITSPLAT_RESOLUTION = 2;

// A splat's life: it climbs this far over this long, opaque until the fade point.
export const HITSPLAT_DURATION_MS = 900;
export const HITSPLAT_RISE = TILE_SIZE * 0.9;
const HITSPLAT_FADE_START = 0.55;

// Splats alive at once; a burst past this drops its oldest, so the newest numbers are the ones
// on screen.
const HITSPLAT_MAX_LIVE = 256;

/**
 * Floating combat text over the world: short runs of text that rise off a tile and fade.
 * A splat is fire-and-forget, so callers get no handle back.
 *
 * Every glyph of every splat is one particle in a single ParticleContainer over the font's one
 * atlas page: positions and colors ride the per-frame dynamic buffer, so hundreds of splats
 * cost one batch and a position write per glyph.
 */
export class HitsplatLayer extends AbstractDrawLayer {

    constructor() {
        super();
        // The manager's install, not BitmapFont.install: only this one hands back the font.
        this._font = BitmapFontManager.install({
            name: HITSPLAT_FONT,
            style: {
                fontFamily: GAME_FONT,
                fontSize: HITSPLAT_FONT_SIZE,
                fontWeight: "bold",
                fill: HITSPLAT_FILL,
                stroke: {color: HITSPLAT_OUTLINE, width: HITSPLAT_OUTLINE_WIDTH},
            },
            chars: HITSPLAT_CHARS,
            resolution: HITSPLAT_RESOLUTION,
            skipKerning: true,
        });
        if (this._font.pages.length !== 1) {
            throw new Error(`Hitsplat font baked onto ${this._font.pages.length} pages`);
        }
        // Glyph metrics and textures are in the font's measurement units, whatever size it was
        // asked for; a splat is those units scaled to the size it renders at.
        this._scale = HITSPLAT_FONT_SIZE / this._font.baseMeasurementFontSize;
        // Every dynamically baked glyph carries the same yOffset (the atlas padding), so one
        // baseline serves a whole run.
        this._baseline = (this._font.baseLineOffset + this._font.chars["0"].yOffset) * this._scale;

        this._particles = new ParticleContainer({
            dynamicProperties: {position: true, color: true},
            roundPixels: true,
        });
        this.addChild(this._particles);
        /**
         * Glyph particles, parked invisible rather than removed: pixi's removeParticle is a
         * linear scan per call, so a burst expiring would go quadratic.
         * @type {DisplayPool}
         * @private
         */
        this._glyphs = new DisplayPool(
            texture => {
                const particle = new Particle({texture, anchorX: 0, anchorY: 0});
                this._particles.addParticle(particle);
                return particle;
            },
            particle => {
                particle.alpha = 0;
            },
            (particle, texture) => {
                particle.texture = texture;
            },
        );
        /**
         * Splats on screen, oldest first.
         * @type {HitsplatEntry[]}
         * @private
         */
        this._live = [];
    }

    get layerIndex() {
        // Above the mod overlays (100), below the placement ghosts (200).
        return 150;
    }

    /**
     * Floats a line of text off a tile. Characters the font has no glyph for are skipped.
     * @param {Object} splat
     * @param {number} splat.tileX - tile coordinate, fractions allowed
     * @param {number} splat.tileY
     * @param {string} splat.text
     * @param {number} splat.color - tint, applied over the black outline
     * @param {number} [splat.jitter] - random spread from the tile center, in tiles
     * @returns {void}
     */
    drawHitsplat({tileX, tileY, text, color, jitter=0}) {
        if (this._live.length >= HITSPLAT_MAX_LIVE) {
            this._release(this._live.shift());
        }
        const width = measureHitsplat(this._font, text) * this._scale;
        const x = (tileX + 0.5 + hitsplatJitterOffset(jitter, Math.random())) * TILE_SIZE - width / 2;
        const y = (tileY + 0.5 + hitsplatJitterOffset(jitter, Math.random())) * TILE_SIZE;
        const entry = new HitsplatEntry(y + this._baseline);
        let penX = 0;
        for (const char of text) {
            const charData = this._font.chars[char];
            if (charData === undefined) {
                continue;
            }
            // A space bakes no glyph; it only advances the pen.
            if (charData.texture !== undefined) {
                const glyph = this._glyphs.acquire(charData.texture);
                glyph.x = x + (penX + charData.xOffset) * this._scale;
                glyph.y = entry.baseY;
                glyph.scaleX = this._scale;
                glyph.scaleY = this._scale;
                glyph.tint = color;
                glyph.alpha = 1;
                entry.glyphs.push(glyph);
            }
            penX += charData.xAdvance;
        }
        this._live.push(entry);
        // Textures and scales are static particle properties, so a spawn flags the flush once
        // for the whole run.
        this._particles.update();
    }

    /**
     * Advances every splat's rise and fade, dropping the ones that have played out.
     * @param {number} frame unused - splats move, they don't cycle frames
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks unused - splats are short-lived, not chunk-mounted
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        for (let i = this._live.length - 1; i >= 0; i -= 1) {
            const entry = this._live[i];
            entry.elapsedMS += deltaMS;
            const progress = entry.elapsedMS / HITSPLAT_DURATION_MS;
            if (progress >= 1) {
                this._release(entry);
                this._live.splice(i, 1);
            } else {
                // Reduced motion keeps the splat on its tile; it still fades out on time.
                const offsetY = ReducedMotion.isEnabled ? 0 : hitsplatOffsetY(progress);
                const alpha = hitsplatAlpha(progress);
                for (const glyph of entry.glyphs) {
                    glyph.y = entry.baseY + offsetY;
                    glyph.alpha = alpha;
                }
            }
        }
    }

    /**
     * Returns a played-out splat's glyphs to the pool.
     * @param {HitsplatEntry} entry
     * @returns {void}
     * @private
     */
    _release(entry) {
        for (const glyph of entry.glyphs) {
            this._glyphs.release(glyph);
        }
    }
}

/**
 * One splat on screen: the glyphs it drew and how far into its life it is.
 */
class HitsplatEntry {

    /**
     * @param {number} baseY - world pixels the run's glyphs sit at before the rise
     */
    constructor(baseY) {
        this.baseY = baseY;
        this.elapsedMS = 0;
        /**
         * @type {Particle[]}
         */
        this.glyphs = [];
    }
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
 * The width of a run in the font's measurement units; unknown characters draw nothing and take
 * no width.
 * @param {BitmapFont} font
 * @param {string} text
 * @returns {number}
 */
export function measureHitsplat(font, text) {
    let width = 0;
    for (const char of text) {
        const charData = font.chars[char];
        if (charData !== undefined) {
            width += charData.xAdvance;
        }
    }
    return width;
}

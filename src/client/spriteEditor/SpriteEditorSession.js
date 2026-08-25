import {reactive} from "vue";
import {drawLine, drawRect, floodFill, fromHex, getPixel, paletteOf, setBlock, toHex} from "@/client/spriteEditor/PixelOps.js";

export const TOOL_PENCIL = "pencil";
export const TOOL_ERASER = "eraser";
export const TOOL_EYEDROPPER = "eyedropper";
export const TOOL_FILL = "fill";
export const TOOL_LINE = "line";
export const TOOL_RECT = "rect";

const UNDO_LIMIT = 100;
const PALETTE_LIMIT = 48;
// Source art is 1x, packed 2x into the atlas: the default brush paints 2x2 atlas pixels.
export const SOURCE_BLOCK = 2;
const TRANSPARENT = [0, 0, 0, 0];
// pixi's untinted tint (0xffffff), so a white pick means "no tint".
export const NO_TINT_HEX = "#ffffff";

/**
 * One paintable frame of a loaded atlas.
 */
export class FrameEntry {

    /**
     * @param {LoadedAtlas} atlas
     * @param {string} name
     * @param {{x: number, y: number, w: number, h: number}} rect
     */
    constructor(atlas, name, rect) {
        this.atlas = atlas;
        this.name = name;
        this.rect = rect;
        // "housing/0-3x3" groups under "housing".
        const slash = name.lastIndexOf("/");
        this.group = slash === -1 ? "" : name.slice(0, slash);
    }
}

/**
 * Editor state shared by the docked and popped-out views: the selected frame's working pixels,
 * tool settings, undo stacks, and the live push into the texture registry + override store.
 */
export class SpriteEditorSession {

    /**
     * @param {TextureRegistry} textureRegistry
     * @param {SpriteOverrideStore} store
     */
    constructor(textureRegistry, store) {
        this.textureRegistry = textureRegistry;
        this.store = store;
        /**
         * @type {FrameEntry[]}
         */
        this.frames = [];
        for (const atlas of textureRegistry.atlases.values()) {
            for (const name of atlas.frameNames) {
                const frame = atlas.sheetData.frames[name];
                if (frame.rotated || frame.trimmed) {
                    continue;
                }
                this.frames.push(new FrameEntry(atlas, name, frame.frame));
            }
        }
        this.frames.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
        /**
         * @type {Map<string, FrameEntry>}
         */
        this.frameByName = new Map(this.frames.map(frame => [frame.name, frame]));
        /**
         * @type {Map<string, ImageData[]>}
         */
        this._undo = new Map();
        /**
         * @type {Map<string, ImageData[]>}
         */
        this._redo = new Map();
        /**
         * @type {ImageData|null}
         */
        this.pixels = null;
        /**
         * @type {ImageData|null}
         */
        this._strokeBase = null;
        this._strokeStart = null;
        this._strokeLast = null;
        this._persistTimer = null;

        this.state = reactive({
            frameName: null,
            tool: TOOL_PENCIL,
            colorHex: "#000000",
            alpha: 255,
            // Preview-only pixi tint over the frame; never painted into the pixels.
            tintHex: NO_TINT_HEX,
            zoom: 12,
            grid: true,
            onion: false,
            playing: false,
            playIndex: 0,
            filter: "",
            // Bumped on every repaint (thumbnails + canvas) and on each committed edit (palette).
            paintVersion: 0,
            commitVersion: 0,
            palette: [],
            canUndo: false,
            canRedo: false,
        });
    }

    /**
     * @returns {FrameEntry|null}
     */
    get frame() {
        if (this.state.frameName === null) {
            return null;
        }
        return this.frameByName.get(this.state.frameName);
    }

    /**
     * @returns {number[]} current paint color
     */
    get rgba() {
        return fromHex(this.state.colorHex, this.state.alpha);
    }

    /**
     * The "<base>/<index>" siblings of the selected frame, in index order, or [] if not a sequence.
     * @returns {FrameEntry[]}
     */
    get sequence() {
        const frame = this.frame;
        if (frame === null || frame.group === "") {
            return [];
        }
        if (!Number.isInteger(Number(frame.name.slice(frame.group.length + 1)))) {
            return [];
        }
        return this.frames.filter(f => f.group === frame.group && Number.isInteger(Number(f.name.slice(f.group.length + 1))));
    }

    /**
     * @param {string} frameName
     * @returns {void}
     */
    select(frameName) {
        if (!this.frameByName.has(frameName)) {
            throw new Error(`Unknown frame: "${frameName}"`);
        }
        this.flushPersist();
        this.state.frameName = frameName;
        this.pixels = this.textureRegistry.frameImageData(frameName);
        this.state.playIndex = 0;
        this._refreshPalette();
        this._syncStacks();
        this.state.paintVersion++;
    }

    /**
     * Begins a stroke at frame pixel (x, y); eyedropper and fill complete here.
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    beginStroke(x, y) {
        if (this.pixels === null || !this._inside(x, y)) {
            return;
        }
        if (this.state.tool === TOOL_EYEDROPPER) {
            const picked = getPixel(this.pixels, x, y);
            if (picked[3] > 0) {
                this.state.colorHex = toHex(picked);
                this.state.alpha = picked[3];
            }
            return;
        }
        this._strokeBase = clone(this.pixels);
        this._strokeStart = [x, y];
        this._strokeLast = [x, y];
        if (this.state.tool === TOOL_FILL) {
            floodFill(this.pixels, x, y, this.rgba, SOURCE_BLOCK);
        } else {
            this._paintSegment(x, y, x, y);
        }
        this._push();
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    moveStroke(x, y) {
        if (this._strokeBase === null || this.state.tool === TOOL_FILL) {
            return;
        }
        if (this.state.tool === TOOL_LINE || this.state.tool === TOOL_RECT) {
            // Shapes preview from the stroke's base so dragging reshapes rather than accumulates.
            this.pixels.data.set(this._strokeBase.data);
            this._paintSegment(this._strokeStart[0], this._strokeStart[1], x, y);
        } else {
            this._paintSegment(this._strokeLast[0], this._strokeLast[1], x, y);
        }
        this._strokeLast = [x, y];
        this._push();
    }

    /**
     * @returns {void}
     */
    endStroke() {
        if (this._strokeBase === null) {
            return;
        }
        this._commit(this._strokeBase);
        this._strokeBase = null;
    }

    /**
     * @returns {void}
     */
    undo() {
        this._swap(this._undo, this._redo);
    }

    /**
     * @returns {void}
     */
    redo() {
        this._swap(this._redo, this._undo);
    }

    /**
     * Restores the selected frame to the shipped atlas art and forgets its stored edit.
     * @returns {Promise<void>}
     */
    async resetFrame() {
        const frame = this.frame;
        if (frame === null) {
            return;
        }
        const original = await loadImage(frame.atlas.imageUrl);
        const canvas = document.createElement("canvas");
        canvas.width = frame.rect.w;
        canvas.height = frame.rect.h;
        const context = canvas.getContext("2d", {willReadFrequently: true});
        context.drawImage(original, frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h, 0, 0, frame.rect.w, frame.rect.h);
        const before = clone(this.pixels);
        this.pixels = context.getImageData(0, 0, frame.rect.w, frame.rect.h);
        this._push();
        this._pushUndo(before);
        this._syncStacks();
        this._refreshPalette();
        this.state.commitVersion++;
        this.flushPersist();
        await this.store.delete(frame.name);
    }

    /**
     * Forgets every stored edit and reloads the shipped atlases.
     * @returns {Promise<void>}
     */
    async resetAll() {
        this.flushPersist();
        await this.store.clear();
        for (const atlas of this.textureRegistry.atlases.values()) {
            this.textureRegistry.replaceAtlas(atlas.name, await loadImage(atlas.imageUrl));
        }
        this._undo.clear();
        this._redo.clear();
        if (this.state.frameName !== null) {
            this.select(this.state.frameName);
        }
        this.state.commitVersion++;
    }

    /**
     * Replaces one atlas with an artist's edited sheet and stores every frame of it.
     * @param {string} atlasName
     * @param {File} file PNG with the atlas's exact layout
     * @returns {Promise<void>}
     */
    async importAtlas(atlasName, file) {
        const bitmap = await createImageBitmap(file);
        try {
            this.textureRegistry.replaceAtlas(atlasName, bitmap);
        } finally {
            bitmap.close();
        }
        for (const frame of this.frames) {
            if (frame.atlas.name === atlasName) {
                await this._persistFrame(frame);
            }
        }
        this._undo.clear();
        this._redo.clear();
        if (this.state.frameName !== null) {
            this.select(this.state.frameName);
        }
        this.state.commitVersion++;
    }

    /**
     * @param {string} atlasName
     * @returns {Promise<Blob>} the atlas PNG as currently edited
     */
    async atlasPng(atlasName) {
        this.flushPersist();
        const atlas = this.textureRegistry.atlases.get(atlasName);
        return new Promise(resolve => atlas.canvas.toBlob(resolve, "image/png"));
    }

    /**
     * The selected frame as a PNG at source (1x) resolution, ready for the sprites directory;
     * a frame the 2x grid does not divide exports at atlas resolution.
     * @returns {Promise<Blob>}
     */
    async framePng() {
        const frame = this.frame;
        this.flushPersist();
        let scale = SOURCE_BLOCK;
        if (frame.rect.w % SOURCE_BLOCK !== 0 || frame.rect.h % SOURCE_BLOCK !== 0) {
            scale = 1;
        }
        const canvas = document.createElement("canvas");
        canvas.width = frame.rect.w / scale;
        canvas.height = frame.rect.h / scale;
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        context.drawImage(frame.atlas.canvas, frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h, 0, 0, canvas.width, canvas.height);
        return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    }

    /**
     * Writes the pending frame to the store now rather than on the debounce.
     * @returns {void}
     */
    flushPersist() {
        if (this._persistTimer !== null) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
            this._persistFrame(this.frame);
        }
    }

    /**
     * @returns {void}
     */
    destroy() {
        this.flushPersist();
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     * @private
     */
    _inside(x, y) {
        return x >= 0 && y >= 0 && x < this.pixels.width && y < this.pixels.height;
    }

    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @private
     */
    _paintSegment(x0, y0, x1, y1) {
        let rgba;
        if (this.state.tool === TOOL_ERASER) {
            rgba = TRANSPARENT;
        } else {
            rgba = this.rgba;
        }
        const block = SOURCE_BLOCK;
        if (this.state.tool === TOOL_RECT) {
            drawRect(this.pixels, x0, y0, x1, y1, rgba, block);
        } else if (x0 === x1 && y0 === y1 && this._inside(x0, y0)) {
            setBlock(this.pixels, x0, y0, rgba, block);
        } else {
            drawLine(this.pixels, x0, y0, x1, y1, rgba, block);
        }
    }

    /**
     * Pushes the working pixels into the live atlas.
     * @private
     */
    _push() {
        this.textureRegistry.patchFrame(this.state.frameName, this.pixels);
        this.state.paintVersion++;
    }

    /**
     * Records `before` for undo and schedules persistence.
     * @param {ImageData} before
     * @private
     */
    _commit(before) {
        this._pushUndo(before);
        this._redo.set(this.state.frameName, []);
        this._syncStacks();
        this._refreshPalette();
        this.state.commitVersion++;
        if (this._persistTimer !== null) {
            clearTimeout(this._persistTimer);
        }
        this._persistTimer = setTimeout(() => {
            this._persistTimer = null;
            this._persistFrame(this.frame);
        }, 300);
    }

    /**
     * @param {ImageData} before
     * @private
     */
    _pushUndo(before) {
        const stack = this._stack(this._undo);
        stack.push(before);
        if (stack.length > UNDO_LIMIT) {
            stack.shift();
        }
    }

    /**
     * @param {Map<string, ImageData[]>} stacks
     * @returns {ImageData[]}
     * @private
     */
    _stack(stacks) {
        let stack = stacks.get(this.state.frameName);
        if (stack === undefined) {
            stack = [];
            stacks.set(this.state.frameName, stack);
        }
        return stack;
    }

    /**
     * Pops `from` onto the working pixels, pushing the current ones onto `to`.
     * @param {Map<string, ImageData[]>} from
     * @param {Map<string, ImageData[]>} to
     * @private
     */
    _swap(from, to) {
        const stack = this._stack(from);
        if (stack.length === 0) {
            return;
        }
        this._stack(to).push(clone(this.pixels));
        this.pixels = stack.pop();
        this._push();
        this._syncStacks();
        this._refreshPalette();
        this.state.commitVersion++;
        this._persistFrame(this.frame);
    }

    /**
     * @param {FrameEntry} frame
     * @returns {Promise<void>}
     * @private
     */
    async _persistFrame(frame) {
        const canvas = document.createElement("canvas");
        canvas.width = frame.rect.w;
        canvas.height = frame.rect.h;
        canvas.getContext("2d").drawImage(frame.atlas.canvas, frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h, 0, 0, frame.rect.w, frame.rect.h);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        await this.store.put(frame.name, blob);
    }

    /**
     * @private
     */
    _syncStacks() {
        this.state.canUndo = this._stack(this._undo).length > 0;
        this.state.canRedo = this._stack(this._redo).length > 0;
    }

    /**
     * @private
     */
    _refreshPalette() {
        this.state.palette = paletteOf(this.pixels, PALETTE_LIMIT).map(rgba => ({hex: toHex(rgba), alpha: rgba[3]}));
    }
}

/**
 * @param {ImageData} pixels
 * @returns {ImageData}
 */
function clone(pixels) {
    return new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
}

/**
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load ${url}`));
        image.src = url;
    });
}

import {Assets, CanvasSource, Spritesheet, Texture} from "pixi.js";

/**
 * One loaded atlas: its frame data and the canvas its texture source draws from.
 */
export class LoadedAtlas {

    /**
     * @param {string} name
     * @param {string} imageUrl
     * @param {object} sheetData
     * @param {HTMLCanvasElement} canvas
     * @param {CanvasSource} source
     */
    constructor(name, imageUrl, sheetData, canvas, source) {
        this.name = name;
        this.imageUrl = imageUrl;
        this.sheetData = sheetData;
        this.canvas = canvas;
        this.source = source;
        this.context = canvas.getContext("2d", {willReadFrequently: true});
    }

    /**
     * Frame names in sheet order.
     * @returns {string[]}
     */
    get frameNames() {
        return Object.keys(this.sheetData.frames);
    }

    /**
     * The pixel rect of `frameName` inside the canvas; rotated/trimmed frames are not paintable.
     * @param {string} frameName
     * @returns {{x: number, y: number, w: number, h: number}}
     */
    frameRect(frameName) {
        const frame = this.sheetData.frames[frameName];
        if (frame === undefined) {
            throw new Error(`Unknown frame "${frameName}" in atlas "${this.name}"`);
        }
        if (frame.rotated || frame.trimmed) {
            throw new Error(`Frame "${frameName}" is rotated or trimmed`);
        }
        return frame.frame;
    }

    /**
     * Re-uploads the canvas.
     * @returns {void}
     */
    update() {
        this.source.update();
    }
}

export class TextureRegistry {

    constructor() {
        /**
         * @type {Object.<string, Texture>}
         */
        this.textures = {};
        /**
         * Frames grouped into ordered sequences by base name, so animated sprites index frames as an array.
         * @type {Object.<string, Texture[]>}
         */
        this.animations = {};
        /**
         * @type {Map<string, LoadedAtlas>}
         */
        this.atlases = new Map();
        /**
         * Which atlas each frame came from.
         * @type {Map<string, LoadedAtlas>}
         */
        this._atlasByFrame = new Map();
    }

    /**
     * @param {TextureAtlas[]} atlases
     * @returns {Promise<void>}
     */
    async load(atlases) {
        await Promise.all(atlases.map(async atlas => {
            // A packaged mod's atlas arrives as a blob URL, which carries no extension for pixi to
            // pick a parser from; naming the texture parser makes both that and a plain URL work.
            const imageTexture = await Assets.load({src: atlas.imageUrl, parser: "texture"});
            // Frames draw from a canvas copy so the sprite editor can repaint them in place.
            const canvas = document.createElement("canvas");
            canvas.width = imageTexture.source.pixelWidth;
            canvas.height = imageTexture.source.pixelHeight;
            canvas.getContext("2d", {willReadFrequently: true}).drawImage(imageTexture.source.resource, 0, 0);
            await Assets.unload(atlas.imageUrl);

            const source = new CanvasSource({resource: canvas, resolution: 1, scaleMode: "nearest"});
            // TexturePacker sets scale=2 because source art was upscaled 2x; override so Pixi renders frames at actual pixel size.
            const data = {...atlas.sheetData, meta: {...atlas.sheetData.meta, scale: "1"}};
            const sheet = new Spritesheet(new Texture({source}), data);
            await sheet.parse();
            Object.assign(this.textures, sheet.textures);

            const name = atlasName(atlas.sheetData);
            if (this.atlases.has(name)) {
                throw new Error(`Duplicate atlas "${name}"`);
            }
            const loaded = new LoadedAtlas(name, atlas.imageUrl, atlas.sheetData, canvas, source);
            this.atlases.set(name, loaded);
            for (const frameName of loaded.frameNames) {
                this._atlasByFrame.set(frameName, loaded);
            }
        }));
        this._buildAnimations();
    }

    /**
     * Groups every "<base>/<index>" frame into this.animations[base][index].
     * @private
     */
    _buildAnimations() {
        this.animations = {};
        for (const name of Object.keys(this.textures)) {
            const slash = name.lastIndexOf("/");
            if (slash === -1) {
                continue;
            }
            const index = Number(name.slice(slash + 1));
            if (!Number.isInteger(index)) {
                continue;
            }
            const base = name.slice(0, slash);
            if (this.animations[base] === undefined) {
                this.animations[base] = [];
            }
            this.animations[base][index] = this.textures[name];
        }
    }

    /**
     * The texture for `name`, throwing if it isn't loaded (a missing texture is a content bug).
     * @param {string} name
     * @returns {Texture}
     */
    get(name) {
        const texture = this.textures[name];
        if (texture === undefined) {
            throw new Error(`Unknown texture: "${name}"`);
        }
        return texture;
    }

    /**
     * The ordered frame textures for an animation sequence, or undefined if no
     * frames are grouped under that base name.
     * @param {string} name base sequence name (e.g. "belt-straight")
     * @returns {Texture[]|undefined}
     */
    getAnimation(name) {
        return this.animations[name];
    }

    /**
     * @param {string} frameName
     * @returns {LoadedAtlas}
     */
    atlasOf(frameName) {
        const atlas = this._atlasByFrame.get(frameName);
        if (atlas === undefined) {
            throw new Error(`Unknown frame: "${frameName}"`);
        }
        return atlas;
    }

    /**
     * A copy of the frame's pixels at atlas resolution.
     * @param {string} frameName
     * @returns {ImageData}
     */
    frameImageData(frameName) {
        const atlas = this.atlasOf(frameName);
        const rect = atlas.frameRect(frameName);
        return atlas.context.getImageData(rect.x, rect.y, rect.w, rect.h);
    }

    /**
     * Replaces the frame's pixels; every sprite drawing it shows the change on its next render.
     * @param {string} frameName
     * @param {ImageData|CanvasImageSource} pixels frame-sized
     * @returns {void}
     */
    patchFrame(frameName, pixels) {
        const atlas = this.atlasOf(frameName);
        const rect = atlas.frameRect(frameName);
        if (pixels.width !== rect.w || pixels.height !== rect.h) {
            throw new Error(`Frame "${frameName}" is ${rect.w}x${rect.h}, got ${pixels.width}x${pixels.height}`);
        }
        if (pixels instanceof ImageData) {
            atlas.context.putImageData(pixels, rect.x, rect.y);
        } else {
            atlas.context.clearRect(rect.x, rect.y, rect.w, rect.h);
            atlas.context.drawImage(pixels, rect.x, rect.y);
        }
        atlas.update();
    }

    /**
     * Replaces a whole atlas image (same layout) from an artist's edited sheet.
     * @param {string} atlasName
     * @param {CanvasImageSource} image
     * @returns {void}
     */
    replaceAtlas(atlasName, image) {
        const atlas = this.atlases.get(atlasName);
        if (atlas === undefined) {
            throw new Error(`Unknown atlas: "${atlasName}"`);
        }
        if (image.width !== atlas.canvas.width || image.height !== atlas.canvas.height) {
            throw new Error(`Atlas "${atlasName}" is ${atlas.canvas.width}x${atlas.canvas.height}, got ${image.width}x${image.height}`);
        }
        atlas.context.clearRect(0, 0, atlas.canvas.width, atlas.canvas.height);
        atlas.context.drawImage(image, 0, 0);
        atlas.update();
    }
}

/**
 * Atlas identity is its image's basename ("main.png" -> "main").
 * @param {object} sheetData
 * @returns {string}
 */
export function atlasName(sheetData) {
    const image = sheetData.meta.image;
    const dot = image.lastIndexOf(".");
    if (dot === -1) {
        return image;
    }
    return image.slice(0, dot);
}

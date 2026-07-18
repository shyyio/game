import {Assets, Spritesheet, Texture} from "pixi.js";

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
    }

    /**
     * @param {TextureDefinition[]} definitions
     * @returns {Promise<void>}
     */
    async load(definitions) {
        await Promise.all(definitions.map(async def => {
            const texture = await Assets.load(def.imageUrl);

            texture.source.scaleMode = "nearest";
            // TexturePacker sets scale=2 because source art was upscaled 2x; override so Pixi renders frames at actual pixel size.
            const data = {...def.jsonUrl, meta: {...def.jsonUrl.meta, scale: "1"}};
            const sheet = new Spritesheet(texture, data);
            await sheet.parse();
            Object.assign(this.textures, sheet.textures);
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
}

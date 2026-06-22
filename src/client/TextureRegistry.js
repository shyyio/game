import {Assets, Spritesheet} from "pixi.js";

export class TextureRegistry {

    constructor() {
        /**
         * @type {Object.<string, Texture>}
         */
        this.textures = {};
    }

    /**
     * @param {ModRegistry} modRegistry
     * @returns {Promise<void>}
     */
    async loadFromModRegistry(modRegistry) {
        await Promise.all(modRegistry.mods.map(async mod => {
            if (!mod.textureDefinitions) {
                return;
            }

            await Promise.all(Object.entries(mod.textureDefinitions).map(async ([name, def]) => {
                const texture = await Assets.load({alias: name, src: def.imageUrl});
                // TexturePacker sets scale=2 because source art was upscaled 2x; override so Pixi renders frames at actual pixel size.
                const data = {...def.jsonUrl, meta: {...def.jsonUrl.meta, scale: "1"}};
                const sheet = new Spritesheet(texture, data);
                await sheet.parse();
                Object.assign(this.textures, sheet.textures);
            }));
        }));
    }

    /**
     * @param {string} name
     * @returns {Texture}
     */
    get(name) {
        return this.textures[name];
    }
}

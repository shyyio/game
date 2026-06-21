import {Assets} from "pixi.js";

export class TextureSet {

    constructor() {
        /**
         * @type {Object.<string, Texture>}
         */
        this.textures = {};
    }

    /**
     * @param {ModSet} modSet
     * @returns {Promise<void>}
     */
    async loadFromModSet(modSet) {
        await Promise.all(modSet.mods.map(async mod => {
            if (!mod.textureDefinitions) {
                return;
            }

            await Promise.all(Object.entries(mod.textureDefinitions).map(async ([name, def]) => {
                const sheet = await Assets.load({alias: name, src: def.imageUrl});
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

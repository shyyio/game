/**
 * One texture atlas a mod package ships: the image plus its parsed TexturePacker frame data.
 * Assets are package-level, not declaration-level — a packaged mod's bundle holds no assets, so its
 * loader builds these from the manifest and the mod's base URL.
 */
export class TextureAtlas {

    /**
     * @param {string} imageUrl
     * @param {object} sheetData parsed atlas JSON
     */
    constructor(imageUrl, sheetData) {
        this.imageUrl = imageUrl;
        this.sheetData = sheetData;
    }
}

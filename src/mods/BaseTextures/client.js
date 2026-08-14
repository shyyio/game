import {AbstractClientMod} from "@/sdk/client.js";
import {baseTextureAtlases} from "./assets.js";

/**
 * BaseTextures is nothing but art: its client part hands the loadout the shared atlases every other
 * mod's object types draw from.
 */
export class BaseTexturesClientMod extends AbstractClientMod {

    /**
     * @returns {TextureAtlas[]}
     */
    textureAtlases() {
        return baseTextureAtlases;
    }
}

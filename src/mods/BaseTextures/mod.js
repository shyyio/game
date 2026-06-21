import {Mod} from "@/common/core.js";
import {TextureDefinition} from "@/common/TextureDefinition.js";
import imageUrl from "./sprites.png";
import jsonUrl from "./sprites.json";

export class CoreTexturesMod extends Mod {

    get textureDefinitions() {
        return {
            core: new TextureDefinition(imageUrl, jsonUrl)
        }
    }

    get definitions() {
        return {};
    }

    get schema() {
        return "";
    }

    get tempSchema() {
        return "";
    }

    get triggers() {
        return "";
    }
}
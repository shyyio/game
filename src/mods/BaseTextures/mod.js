import {Mod, TextureDefinition} from "@/sdk/common.js";
import imageUrl from "./sprites.png";
import jsonUrl from "./sprites.json";

export class BaseTexturesMod extends Mod {

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
}
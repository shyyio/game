import {Mod, TextureDefinition} from "@/sdk/common.js";
import imageUrl from "./sprites.png";
import jsonUrl from "./sprites.json";

export class BaseTexturesMod extends Mod {

    get textureDefinitions() {
        return [
            new TextureDefinition(imageUrl, jsonUrl)
        ];
    }
}
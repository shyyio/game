import {AbstractModDeclaration, TextureDefinition} from "@/sdk/common.js";
import imageUrl from "./sprites.png";
import jsonUrl from "./sprites.json";

export class BaseTexturesDeclaration extends AbstractModDeclaration {

    get textureDefinitions() {
        return [
            new TextureDefinition(imageUrl, jsonUrl)
        ];
    }
}

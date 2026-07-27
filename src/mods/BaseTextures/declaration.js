import {AbstractModDeclaration, TextureDefinition} from "@/sdk/common.js";
import animatedImageUrl from "./animated.png";
import animatedJsonUrl from "./animated.json";
import mainImageUrl from "./main.png";
import mainJsonUrl from "./main.json";

export class BaseTexturesDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "BaseTextures";
    }

    get textureDefinitions() {
        return [
            new TextureDefinition(animatedImageUrl, animatedJsonUrl),
            new TextureDefinition(mainImageUrl, mainJsonUrl)
        ];
    }
}

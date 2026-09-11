import {TextureAtlas} from "@spup/sdk";
import spritesImageUrl from "./sprites.png";
import spritesSheet from "./sprites.json";

// The mod's art: an image and the JSON naming each frame in it. A packaged mod carries both inline.
export const pebbleGeneratorTextureAtlases = [
    new TextureAtlas(spritesImageUrl, spritesSheet),
];

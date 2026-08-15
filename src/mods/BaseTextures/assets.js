// The mod's atlases. The asset imports resolve through vite in the static loadout and are inlined
// by tools/build-mod.js (image as a data URL, frame data as an object literal) in a packaged one, so
// this is the same list either way.

import {TextureAtlas} from "@spup/sdk";
import animatedImageUrl from "./animated.png";
import animatedSheet from "./animated.json";
import mainImageUrl from "./main.png";
import mainSheet from "./main.json";

export const baseTextureAtlases = [
    new TextureAtlas(animatedImageUrl, animatedSheet),
    new TextureAtlas(mainImageUrl, mainSheet),
];

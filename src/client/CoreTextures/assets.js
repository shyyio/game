// The client's own atlas

import {TextureAtlas} from "@/common/TextureAtlas.js";
import coreImageUrl from "./core.png";
import coreSheet from "./core.json";

export const coreTextureAtlases = [
    new TextureAtlas(coreImageUrl, coreSheet),
];

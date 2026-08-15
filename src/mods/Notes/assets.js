import {TextureAtlas} from "@spup/sdk";
import notesImageUrl from "./notes.png";
import notesSheet from "./notes.json";

export const notesTextureAtlases = [
    new TextureAtlas(notesImageUrl, notesSheet),
];

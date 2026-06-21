
import {SplitterMod} from "@/mods/Splitter/mod.js";
import {SplitterDrawLayer} from "@/mods/Splitter/SplitterLayer.js";

export class SplitterClientMod extends SplitterMod {

    get drawLayers() {
        return [new SplitterDrawLayer()];
    }

}

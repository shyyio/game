
import {SplitterMod} from "./mod.js";
import {SplitterDrawLayer} from "./SplitterLayer.js";

export class SplitterClientMod extends SplitterMod {

    get drawLayers() {
        return [
            new SplitterDrawLayer()
        ];
    }
}

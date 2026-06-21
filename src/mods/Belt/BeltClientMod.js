
import {BeltMod} from "@/mods/Belt/mod.js";
import {BeltDrawLayer} from "@/mods/Belt/BeltLayer.js";
import {BeltOverlayDrawLayer} from "@/mods/Belt/OverlayLayer.js";
import {BeltTool} from "@/mods/Belt/BeltTool.js";

export class BeltClientMod extends BeltMod {

    get drawLayers() {
        return [new BeltDrawLayer(), new BeltOverlayDrawLayer()];
    }

    getTools(session, playerSettings) {
        return [new BeltTool(session)];
    }

}

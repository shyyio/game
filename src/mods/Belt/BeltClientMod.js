
import {BeltMod} from "@/mods/Belt/mod.js";
import {BeltDrawLayer} from "@/mods/Belt/BeltLayer.js";
import {BeltOverlayDrawLayer} from "@/mods/Belt/OverlayLayer.js";
import {BeltTool} from "@/mods/Belt/BeltTool.js";
import {DeleteBeltMessage} from "@/mods/Belt/messages.js";
import {MiniMenuEntry} from "@/sdk/client.js";

export class BeltClientMod extends BeltMod {

    get drawLayers() {
        return [new BeltDrawLayer(), new BeltOverlayDrawLayer()];
    }

    tools(session, playerSettings) {
        // TODO: Return tools that are available for the player, based on playerSettings
        return [new BeltTool(session, this.game)];
    }

    miniMenuContextEntries(tileX, tileY, session) {
        const id = this.game.queryScalar("GetBeltAtTile", {x: tileX, y: tileY});

        if (id == null) {
            return [];
        }

        return [
            new MiniMenuEntry(
                "Delete belt",
                10,
                () => session.sendMessage(new DeleteBeltMessage(id)),
            ),
        ];
    }

}

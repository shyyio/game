
import {BeltMod} from "./mod.js";
import {BeltDrawLayer} from "./BeltLayer.js";
import {BeltOverlayDrawLayer} from "./OverlayLayer.js";
import {BeltTool} from "./BeltTool.js";
import {DeleteBeltMessage} from "./messages.js";
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

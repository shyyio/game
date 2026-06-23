
import {BeltMod} from "./mod.js";
import {BeltDrawLayer} from "./BeltLayer.js";
import {BeltOverlayDrawLayer} from "./OverlayLayer.js";
import {BeltGhostLayer} from "./BeltGhostLayer.js";
import {BeltTool} from "./BeltTool.js";
import {UndergroundBeltTool} from "./UndergroundBeltTool.js";
import {DeleteBeltMessage} from "./messages.js";
import {MiniMenuEntry} from "@/sdk/client.js";

export class BeltClientMod extends BeltMod {

    constructor() {
        super();
        // One stable instance shared between drawLayers (which renders it) and
        // tools (which drive it via showGhost/clear).
        this._ghostLayer = new BeltGhostLayer();
    }

    get drawLayers() {
        return [new BeltDrawLayer(), new BeltOverlayDrawLayer(), this._ghostLayer];
    }

    tools(session, playerSettings) {
        // TODO: Return tools that are available for the player, based on playerSettings
        return [
            new BeltTool(session, this.game, this._ghostLayer),
            new UndergroundBeltTool(session, this.game, this._ghostLayer)
        ];
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

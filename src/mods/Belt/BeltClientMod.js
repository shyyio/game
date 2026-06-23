
import {BeltMod} from "./mod.js";
import {BeltDrawLayer} from "./BeltLayer.js";
import {BeltOverlayDrawLayer} from "./OverlayLayer.js";
import {BeltGhostLayer} from "./BeltGhostLayer.js";
import {BeltTool} from "./BeltTool.js";
import {UndergroundBeltTool} from "./UndergroundBeltTool.js";
import {DeleteBeltMessage} from "./messages.js";
import {
    BeltInsertEvent,
    BeltSyncEvent,
    BeltUpdateEvent,
    BeltDeleteEvent,
} from "./events.js";
import {BeltType} from "./constants.js";
import {
    MiniMenuEntry,
    ViewportCache,
    ChunkUnsubscribeEvent,
} from "@/sdk/client.js";

export class BeltClientMod extends BeltMod {

    constructor() {
        super();
        // One stable instance shared between drawLayers (which renders it) and
        // tools (which drive it via showGhost/clear).
        this._ghostLayer = new BeltGhostLayer();
        // The client's own picture of placed belts, kept current by onClientEvent
        // and queried by tools/menus — the browser never reads the simulation DB.
        this._beltCache = new ViewportCache();
        // Stable belt layer: onClientEvent drives it imperatively.
        this._beltLayer = new BeltDrawLayer();
    }

    get drawLayers() {
        return [this._beltLayer, new BeltOverlayDrawLayer(), this._ghostLayer];
    }

    tools(session, playerSettings) {
        // TODO: Return tools that are available for the player, based on playerSettings
        return [
            new BeltTool(session, this._beltCache, this._ghostLayer),
            new UndergroundBeltTool(session, this._beltCache, this._ghostLayer)
        ];
    }

    /**
     * Single client-side hub for belt events: keeps the belt cache and belt layer
     * in lockstep. A BeltInsertEvent is a live placement and a BeltSyncEvent seeds a
     * belt that existed before its chunk loaded — same payload, handled identically
     * for now (the distinct types leave room for placement-only feedback later);
     * update/delete track changes; chunk-unsubscribe tears down the belts in chunks
     * that left the viewport.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onClientEvent(event, client) {
        if (event instanceof BeltInsertEvent || event instanceof BeltSyncEvent) {
            this._addBelt(event);
            return;
        }
        if (event instanceof BeltUpdateEvent) {
            this._beltCache.update(event.id, {parentX: event.newParentX, parentY: event.newParentY});
            this._beltLayer.updateBelt(event.id, event.newParentX, event.newParentY);
            return;
        }
        if (event instanceof BeltDeleteEvent) {
            this._beltCache.remove(event.id);
            this._beltLayer.removeBelt(event.id);
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            const removedIds = this._beltCache.clearChunk(event.chunk);
            removedIds.forEach(id => {
                this._beltLayer.removeBelt(id);
            });
        }
    }

    /**
     * Adds a belt to the viewport cache and the draw layer. Shared by live inserts and
     * chunk-sync seeds, which carry identical data.
     * @param {BeltInsertEvent|BeltSyncEvent} event
     * @private
     */
    _addBelt(event) {
        this._beltCache.insert(event.id, event.x, event.y, {
            direction: event.direction,
            type: event.beltType,
            parentX: event.parentX,
            parentY: event.parentY,
        });
        this._beltLayer.addBelt(event.id, event.x, event.y, event.direction, event.beltType, event.parentX, event.parentY);
    }

    miniMenuContextEntries(tileX, tileY, session) {
        const records = this._beltCache.getAtTile(tileX, tileY);
        const surface = records.find(record => record.data.type !== BeltType.UNDERGROUND);

        if (surface === undefined) {
            return [];
        }

        return [
            new MiniMenuEntry(
                "Delete belt",
                10,
                () => session.sendMessage(new DeleteBeltMessage(surface.id)),
            ),
        ];
    }

}

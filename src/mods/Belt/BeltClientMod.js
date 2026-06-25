
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
import {surfaceBeltAt, walkTunnel} from "./geometry.js";
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
        // Reveals buried tunnel belts under a hovered ramp; driven by onInspect.
        this._overlayLayer = new BeltOverlayDrawLayer();
    }

    get drawLayers() {
        return [this._beltLayer, this._overlayLayer, this._ghostLayer];
    }

    tools(client) {
        // TODO: Filter to the tools available for the player (client.playerSettings).
        return [
            new BeltTool(client, this._beltCache, this._ghostLayer),
            new UndergroundBeltTool(client, this._beltCache, this._ghostLayer),
        ];
    }

    /**
     * Single client-side hub for belt events, keeping the belt cache and belt layer in lockstep.
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
     * Adds a belt to the viewport cache and the draw layer (shared by inserts and seeds).
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

    /**
     * Tool-less hover: reveal the buried tunnel under a hovered ramp and return the tiles to highlight.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {{x: number, y: number, alt?: boolean}[]}
     */
    onInspect(tileX, tileY) {
        if (tileX === null) {
            this._overlayLayer.clearUndergroundReveal();
            return [];
        }
        const records = this._beltCache.getAtTile(tileX, tileY);
        const surface = surfaceBeltAt(this._beltCache, tileX, tileY);
        const ramp = records.find(record =>
            record.data.type === BeltType.RAMP_DOWN || record.data.type === BeltType.RAMP_UP);
        const tunnel = ramp === undefined ? null : walkTunnel(this._beltCache, ramp);

        // Highlight the hovered surface belt/ramp (buried undergrounds aren't drawn),
        // plus the ramp it tunnels to (if any) with the alternate highlight.
        const inspectTiles = [];
        if (surface !== null) {
            inspectTiles.push({x: tileX, y: tileY});
        }
        if (tunnel !== null && tunnel.pair !== null) {
            inspectTiles.push({x: tunnel.pair.tileX, y: tunnel.pair.tileY, alt: true});
        }

        if (tunnel === null) {
            this._overlayLayer.clearUndergroundReveal();
        } else {
            this._overlayLayer.showUndergroundReveal(tunnel.tiles, ramp.data.direction);
        }
        return inspectTiles;
    }

    miniMenuContextEntries(tileX, tileY, session) {
        const surface = surfaceBeltAt(this._beltCache, tileX, tileY);

        if (surface === null) {
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

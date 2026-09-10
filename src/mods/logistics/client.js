import {BeltDrawLayer} from "./client/BeltDrawLayer.js";
import {BeltOverlayDrawLayer} from "./client/BeltOverlayDrawLayer.js";
import {BeltGhostLayer} from "./client/BeltGhostLayer.js";
import {BeltTool} from "./client/BeltTool.js";
import {UndergroundBeltTool} from "./client/UndergroundBeltTool.js";
import {LOGISTICS_SCHEMA, LogisticsWriter} from "./client/LogisticsState.js";
import {WireDrawLayer} from "./client/WireDrawLayer.js";
import {WireTool} from "./client/WireTool.js";
import {LogicTerminalConfigLayer} from "./client/LogicTerminalConfigLayer.js";
import {isBeltType, isGateType, isTerminalType} from "./common/objectTypes.js";
import {LogicWireSetEvent, LogicWireClearEvent} from "./common/events.js";
import {tunnelStep, BELT_TUNNEL_UP} from "./common/constants.js";
import {walkTunnel, isTunnelMouth} from "./common/geometry.js";
import {isPlacementBlockedByGate, gateConnections} from "./common/gateConnections.js";
import {
    AbstractClientMod,
    Direction,
    InspectHighlight,
    Rectangle,
    TILE_SIZE,
    LAYER_SURFACE,
    CONVEYS_ITEM,
    CONVEYS_FLUID,
} from "@spup/sdk/client";

export class LogisticsClientMod extends AbstractClientMod {

    constructor() {
        super();
        // Shared between drawLayers (renders it) and tools (drive it).
        this._ghostLayer = new BeltGhostLayer();
        // Fed by the object cache; items ride the core's lane item layer.
        this._beltLayer = new BeltDrawLayer();
        // Reveals buried tunnel belts under a hovered mouth.
        this._overlayLayer = new BeltOverlayDrawLayer();
        // Catenary overlay for the logic network, fed in setup.
        this._wireLayer = new WireDrawLayer();
        // Screen-space terminal panel, built in setup.
        this._terminalConfigLayer = null;
    }

    drawLayers(client) {
        return [
            this._beltLayer,
            this._overlayLayer,
            this._ghostLayer,
            this._wireLayer,
        ];
    }

    tools(client) {
        // TODO: Filter to the tools available for the player (playerSettings state).
        return [
            new BeltTool(client, this._ghostLayer),
            new UndergroundBeltTool(client, this._ghostLayer),
            new WireTool(client, this._wireLayer),
        ];
    }

    /**
     * Registers cache listeners keeping belt rendering in lockstep with every belt entry.
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {
        client.cache.register("logistics", LOGISTICS_SCHEMA, new LogisticsWriter(client.cache, client.session));
        this._terminalConfigLayer = new LogicTerminalConfigLayer(client.app, client.cache, client.modRegistry);
        this._wireLayer.bindObjects(client.objects);
        client.objects.onSet(entry => {
            if (isBeltType(entry.data.type)) {
                this._onBeltSet(client, entry);
            }
            if (isGateType(entry.data.type)) {
                this._predictGateMode(client, entry);
            }
            if (entry.data.type.conveys !== null) {
                this._predictNeighborGateModes(client, entry);
            }
            if (entry.data.type.wireAnchor !== null) {
                this._wireLayer.touchEndpoint(entry.id);
            }
        });
        client.objects.onRemove(entry => {
            if (isBeltType(entry.data.type)) {
                this._onBeltRemoved(client, entry);
            }
            if (entry.data.type.wireAnchor !== null) {
                this._wireLayer.removeEndpoint(entry.id);
            }
            if (isTerminalType(entry.data.type) && client.cache.get("logistics.configTarget") === entry.id) {
                client.cache.writer("logistics").closeTerminalConfig();
            }
        });
    }

    /**
     * @param {Client} client
     * @returns {Container[]}
     */
    hudLayers(client) {
        return [this._terminalConfigLayer];
    }

    /**
     * Mirrors the sim's gate placement guard.
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {Client} client
     * @returns {boolean}
     */
    canPlace(type, tileX, tileY, direction, client) {
        return !isPlacementBlockedByGate(
            this._findOccupantAt(client),
            occupant => isGateType(occupant.type),
            type, tileX, tileY, direction,
        );
    }

    /**
     * The SURFACE occupant resolver the shared connection rules use.
     * @private
     * @param {Client} client
     * @returns {function(number, number): ({type: ObjectType, direction: Direction}|null)}
     */
    _findOccupantAt(client) {
        return (x, y) => {
            const entry = client.objects.findObjectAt(x, y, LAYER_SURFACE);
            if (entry === null) {
                return null;
            }
            return {type: entry.data.type, direction: entry.data.direction};
        };
    }

    /**
     * Predicts a gate's mode from its coupled transports, a tick ahead of the sim's review.
     * @private
     * @param {Client} client
     * @param {CacheEntry} entry - the gate's entry
     * @returns {void}
     */
    _predictGateMode(client, entry) {
        const kinds = gateConnections(this._findOccupantAt(client), entry.tileX, entry.tileY, entry.data.direction);
        const hasItem = kinds.behind === CONVEYS_ITEM || kinds.front === CONVEYS_ITEM;
        const hasFluid = kinds.behind === CONVEYS_FLUID || kinds.front === CONVEYS_FLUID;
        if (hasFluid && !hasItem) {
            client.objects.update(entry.id, {fluid: 1});
        } else if (hasItem && !hasFluid) {
            client.objects.update(entry.id, {fluid: 0});
        }
    }

    /**
     * Re-predicts the mode of every gate a set transport entry touches.
     * @private
     * @param {Client} client
     * @param {CacheEntry} entry - the transport's entry
     * @returns {void}
     */
    _predictNeighborGateModes(client, entry) {
        for (const cell of entry.cells) {
            if (cell.layer !== LAYER_SURFACE) {
                continue;
            }
            for (let direction = 0; direction < 4; direction += 1) {
                const neighbor = client.objects.findObjectAt(
                    cell.x + Direction.dx(direction),
                    cell.y + Direction.dy(direction),
                    LAYER_SURFACE,
                );
                if (neighbor !== null && isGateType(neighbor.data.type)) {
                    this._predictGateMode(client, neighbor);
                }
            }
        }
    }

    /**
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onEvent(event, client) {
        if (event instanceof LogicWireSetEvent) {
            this._wireLayer.setEdge(event.aObjectRef, event.bObjectRef);
            return;
        }
        if (event instanceof LogicWireClearEvent) {
            this._wireLayer.removeEdge(event.aObjectRef, event.bObjectRef);
        }
    }

    /**
     * Adds a cached belt entry to the draw layer; a mouth also masks the item layer with its roof.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _onBeltSet(client, entry) {
        const kind = entry.data.type.beltKind;
        this._beltLayer.addBelt(entry.id, entry.tileX, entry.tileY, entry.data.direction, kind);
        if (isTunnelMouth(kind)) {
            this._addTunnelMasks(client, entry);
        }
    }

    /**
     * Clears everything hanging off a removed belt entry.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _onBeltRemoved(client, entry) {
        this._beltLayer.removeBelt(entry.id);
        if (isTunnelMouth(entry.data.type.beltKind)) {
            this._removeTunnelMasks(client, entry.id);
        }
    }

    /**
     * Adds a mouth's item occluders: a roof on its own tile and a threshold strip on the buried neighbor.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _addTunnelMasks(client, entry) {
        const kind = entry.data.type.beltKind;
        const direction = entry.data.direction;
        // TUNNEL_DOWN roofs its up edge (tunnel mouth), TUNNEL_UP its down edge (where items surface).
        const roofY = kind === BELT_TUNNEL_UP ? TILE_SIZE - 36 : 0;
        const roof = new Rectangle(0, roofY, TILE_SIZE, 36);
        client.itemLayer.addMask(`roof:${entry.id}`, entry.tileX, entry.tileY, roof, direction);
        const step = tunnelStep(kind, direction);
        // Rotating by the direction back toward the mouth lands the band on the shared edge.
        const edgeDirection = Direction.fromDelta(-step.dx, -step.dy);
        const threshold = new Rectangle(0, 0, TILE_SIZE, TILE_SIZE / 4);
        client.itemLayer.addMask(`threshold:${entry.id}`, entry.tileX + step.dx, entry.tileY + step.dy, threshold, edgeDirection);
    }

    /**
     * Removes a mouth's roof and threshold occluders.
     * @param {Client} client
     * @param {number} id - the mouth's belt id
     * @private
     */
    _removeTunnelMasks(client, id) {
        client.itemLayer.removeMask(`roof:${id}`);
        client.itemLayer.removeMask(`threshold:${id}`);
    }

    /**
     * Tool-less hover: reveal the buried tunnel under a hovered mouth and highlight both its ends.
     * Plain belts draw no highlight.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {Client} client
     * @returns {InspectHighlight[]}
     */
    onInspect(tileX, tileY, client) {
        if (tileX === null) {
            this._overlayLayer.clearUndergroundReveal();
            return [];
        }
        const records = client.objects.getAtTile(tileX, tileY);
        const mouth = records.find(record => isBeltType(record.data.type) && isTunnelMouth(record.data.type.beltKind));
        const tunnel = mouth === undefined ? null : walkTunnel(client.objects, mouth);
        if (tunnel === null) {
            this._overlayLayer.clearUndergroundReveal();
        } else {
            this._overlayLayer.showUndergroundReveal(tunnel.tiles, mouth.data.direction);
        }
        if (mouth === undefined) {
            return [];
        }
        // The hovered mouth, plus the mouth it tunnels to (alternate highlight).
        const highlights = [new InspectHighlight(mouth.tileX, mouth.tileY, mouth.data.direction, mouth.data.type)];
        if (tunnel !== null && tunnel.pair !== null) {
            highlights.push(new InspectHighlight(
                tunnel.pair.tileX,
                tunnel.pair.tileY,
                tunnel.pair.data.direction,
                tunnel.pair.data.type,
                true,
            ));
        }
        return highlights;
    }
}

import {BeltDrawLayer, ELEVATED_DRAW_HEIGHT} from "./client/BeltDrawLayer.js";
import {BeltOverlayDrawLayer} from "./client/BeltOverlayDrawLayer.js";
import {BeltGhostLayer} from "./client/BeltGhostLayer.js";
import {BeltTool} from "./client/BeltTool.js";
import {LOGISTICS_SCHEMA, LogisticsWriter} from "./client/LogisticsState.js";
import {WireDrawLayer} from "./client/WireDrawLayer.js";
import {WireTool} from "./client/WireTool.js";
import {LogicTerminalConfigLayer} from "./client/LogicTerminalConfigLayer.js";
import {isBeltType, isGateType, isTerminalType} from "./common/objectTypes.js";
import {LogicWireSetEvent, LogicWireClearEvent} from "./common/events.js";
import {
    tunnelStep,
    BELT_TUNNEL_UP,
    getBuildLevelByBeltKind,
    getDrawLevelByBeltKind,
    DRAW_LAYER_BELT,
    DRAW_LAYER_BELT_ELEVATED_1,
} from "./common/constants.js";
import {walkTunnel, isTunnelMouth, getTopBeltAtOrNull} from "./common/geometry.js";
import {isPlacementBlockedByGate, gateConnections} from "./common/gateConnections.js";
import {
    AbstractClientMod,
    Direction,
    InspectHighlightSprite,
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
        // One layer per level, indexed by it: each elevated one draws over the objects its run
        // passes and sits a level's height further off the ground. Lane geometry names a belt
        // without its level, so the parent edges it carries are shared across the levels.
        const parentEdges = new Map();
        this._beltLayers = [
            new BeltDrawLayer(DRAW_LAYER_BELT, 0, parentEdges),
            new BeltDrawLayer(DRAW_LAYER_BELT_ELEVATED_1, ELEVATED_DRAW_HEIGHT, parentEdges),
        ];
        // Reveals buried tunnel belts under a hovered mouth.
        this._overlayLayer = new BeltOverlayDrawLayer();
        // Catenary overlay for the logic network, fed in init.
        this._wireLayer = new WireDrawLayer();
        // Screen-space terminal panel, built in init.
        this._terminalConfigLayer = null;
        // The one belt tool, held so a tap on a belt can open it on that belt's level.
        this._beltTool = null;
    }

    drawLayers(client) {
        return this._beltLayers.concat([
            this._overlayLayer,
            this._ghostLayer,
            this._wireLayer,
        ]);
    }

    tools(client) {
        // TODO: Filter to the tools available for the player (playerSettings state).
        this._beltTool = new BeltTool(client, this._ghostLayer);
        return [
            this._beltTool,
            new WireTool(client, this._wireLayer),
        ];
    }

    /**
     * Tool-less tap on a belt: opens the belt tool on that belt's own level, so laying more of the
     * line carries on where it left off.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Client} client
     * @returns {boolean}
     */
    onObjectTap(tileX, tileY, client) {
        const belt = getTopBeltAtOrNull(client.objects, tileX, tileY);
        if (belt === null || this._beltTool === null) {
            return false;
        }
        // Set before selecting: the toolbar renders the tool's status line as it activates.
        this._beltTool.setLevel(getBuildLevelByBeltKind(belt.data.type.beltKind));
        client.hud.toolbarLayer.setActiveTool(this._beltTool);
        return true;
    }

    /**
     * Registers cache listeners keeping belt rendering in lockstep with every belt entry.
     * @param {Client} client
     * @returns {void}
     */
    init(client) {
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
            this._createOccupantLookup(client),
            occupant => isGateType(occupant.type),
            type, tileX, tileY, direction,
        );
    }

    /**
     * The SURFACE occupant resolver the shared connection rules use.
     * @private
     * @param {Client} client
     * @returns {function(number, number): (Occupant|null)}
     */
    _createOccupantLookup(client) {
        return (x, y) => getOccupantAtOrNull(client, x, y);
    }

    /**
     * Predicts a gate's mode from its coupled transports, a tick ahead of the sim's review.
     * @private
     * @param {Client} client
     * @param {CacheEntry} entry - the gate's entry
     * @returns {void}
     */
    _predictGateMode(client, entry) {
        const kinds = gateConnections(this._createOccupantLookup(client), entry.tileX, entry.tileY, entry.data.direction);
        const hasItem = kinds.behind === CONVEYS_ITEM || kinds.front === CONVEYS_ITEM;
        const hasFluid = kinds.behind === CONVEYS_FLUID || kinds.front === CONVEYS_FLUID;
        if (hasFluid && !hasItem) {
            client.objects.apply(entry.id, {fluid: 1});
        } else if (hasItem && !hasFluid) {
            client.objects.apply(entry.id, {fluid: 0});
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
                const neighbor = client.objects.getObjectAtOrNull(
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
        this._getBeltLayerByKind(kind)
            .addBelt(entry.id, entry.tileX, entry.tileY, entry.data.direction, kind);
        if (isTunnelMouth(kind)) {
            this._addTunnelMasks(client, entry);
        }
    }

    /**
     * The draw layer a belt of this kind renders in.
     * @param {BeltType} kind
     * @returns {BeltDrawLayer}
     * @private
     */
    _getBeltLayerByKind(kind) {
        return this._beltLayers[getDrawLevelByBeltKind(kind)];
    }

    /**
     * Clears everything hanging off a removed belt entry.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _onBeltRemoved(client, entry) {
        this._getBeltLayerByKind(entry.data.type.beltKind).removeBelt(entry.id);
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
     * Tool-less hover: highlight the belt under the pointer, and for a tunnel mouth reveal its
     * buried span and highlight the mouth it pairs with.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {Client} client
     * @returns {InspectHighlightSprite[]}
     */
    onInspect(tileX, tileY, client) {
        if (tileX === null) {
            this._overlayLayer.clearUndergroundReveal();
            return [];
        }
        const entries = client.objects.getAtTile(tileX, tileY);
        const mouth = entries.find(entry => isBeltType(entry.data.type) && isTunnelMouth(entry.data.type.beltKind));
        let tunnel;
        if (mouth === undefined) {
            tunnel = null;
        } else {
            tunnel = walkTunnel(client.objects, mouth);
        }
        if (tunnel === null) {
            this._overlayLayer.clearUndergroundReveal();
        } else {
            this._overlayLayer.showUndergroundReveal(tunnel.tiles, mouth.data.direction);
        }
        const belt = getTopBeltAtOrNull(client.objects, tileX, tileY);
        if (belt === null) {
            return [];
        }
        const highlights = [this._createBeltHighlight(belt, false)];
        // The mouth it tunnels to takes the alternate highlight.
        if (tunnel !== null && tunnel.pair !== null) {
            highlights.push(this._createBeltHighlight(tunnel.pair, true));
        }
        return highlights;
    }

    /**
     * A belt's hover highlight, riding as far off the ground as the belt itself draws.
     * @private
     * @param {CacheEntry} belt
     * @param {boolean} alt
     * @returns {InspectHighlightSprite}
     */
    _createBeltHighlight(belt, alt) {
        return new InspectHighlightSprite({
            tileX: belt.tileX,
            tileY: belt.tileY,
            direction: belt.data.direction,
            type: belt.data.type,
            alt,
            drawHeight: getDrawLevelByBeltKind(belt.data.type.beltKind) * ELEVATED_DRAW_HEIGHT,
        });
    }
}

/**
 * The SURFACE occupant at (x, y) as the connection rules see it, or null.
 * @param {Client} client
 * @param {number} x
 * @param {number} y
 * @returns {Occupant|null}
 */
function getOccupantAtOrNull(client, x, y) {
    const entry = client.objects.getObjectAtOrNull(x, y, LAYER_SURFACE);
    if (entry === null) {
        return null;
    }
    return {type: entry.data.type, direction: entry.data.direction};
}

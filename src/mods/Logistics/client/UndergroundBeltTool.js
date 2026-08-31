import {AbstractTool, Direction, Haptics, LAYER_SURFACE, CreateObjectMessage, DeleteObjectMessage} from "@spup/sdk/client";
import {BeltBend, MAX_UNDERGROUND_LENGTH, BELT_NORMAL, BELT_TUNNEL_DOWN, BELT_TUNNEL_UP} from "../common/constants.js";
import {BeltDefinition, BeltTunnelDownDefinition, BeltTunnelUpDefinition, isBeltType} from "../common/objectTypes.js";
import {Belt} from "./BeltDrawLayer.js";
import {getUndergroundBeltsToCreate, surfaceBeltAt, inferBeltParent, findTunnelPartner} from "../common/geometry.js";

/**
 * Rotatable single-mouth tool that drops one mouth per tap, pairing it with the mouth it tunnels to.
 */
export class UndergroundBeltTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {BeltGhostLayer} ghostLayer
     */
    constructor(client, ghostLayer) {
        super(client.session);
        this._client = client;
        this._cache = client.objects;
        this._ghostLayer = ghostLayer;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._rotation = client.toolRotation;
    }

    get label() {
        return "Tunnel";
    }

    get id() {
        return 3;
    }

    get textureName() {
        return "belt-tunnel-down/0";
    }

    onTap(tileX, tileY) {
        this._placeTunnelMouth(tileX, tileY, this._rotation.direction);
    }

    onTileEnter(tileX, tileY) {
        const placement = this._resolvePlacement(tileX, tileY, this._rotation.direction);
        const blocked = this._blocked(tileX, tileY, placement);
        // An overwritable same-axis belt is deleted before the mouth lands.
        const overwrite = !blocked && this._surfaceBeltAt(tileX, tileY) !== null;
        const tile = [{x: tileX, y: tileY}];
        let blockedTiles = [];
        if (blocked) {
            blockedTiles = tile;
        }
        let overwriteTiles = [];
        if (overwrite) {
            overwriteTiles = tile;
        }
        let clearTiles = tile;
        if (blocked || overwrite) {
            clearTiles = [];
        }
        this._placementFeedbackLayer.show({
            blocked: blockedTiles,
            overwrite: overwriteTiles,
            clear: clearTiles,
            showTarget: true,
        });
        if (blocked || placement.parentId === null) {
            this._ghostLayer.showGhost(tileX, tileY, placement.direction, placement.type, BeltBend.STRAIGHT, blocked);
            return;
        }
        const undergroundTiles = this._undergroundTilesFor(
            placement.parentId,
            tileX,
            tileY,
            placement.type,
            placement.direction,
        );
        const atMax = undergroundTiles.length === MAX_UNDERGROUND_LENGTH;
        this._ghostLayer.showTunnelPreview(tileX, tileY, placement.direction, placement.type, undergroundTiles, atMax);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._placementFeedbackLayer.clear();
    }

    onDragTile(tileX, tileY, direction) {
        // No-op: mouths place by tap only.
    }

    /**
     * Every belt at a tile (surface or underground), as mouth-partner-scan candidates.
     * @private
     * @returns {{id: number, type: BeltType, direction: Direction}[]}
     */
    _beltCandidatesAt(tileX, tileY) {
        return this._cache.getAtTile(tileX, tileY)
            .filter(record => isBeltType(record.data.type))
            .map(record => ({id: record.id, type: record.data.type.beltKind, direction: record.data.direction}));
    }

    /**
     * The surface belt at the tile (with a `straight` flag), or null.
     * @private
     * @returns {{id: number, type: BeltType, direction: Direction, straight: boolean}|null}
     */
    _surfaceBeltAt(tileX, tileY) {
        const surface = surfaceBeltAt(this._cache, tileX, tileY);
        if (surface === null) {
            return null;
        }
        const {parentX, parentY} = inferBeltParent(this._cache, surface.tileX, surface.tileY, surface.data.direction);
        const bend = Belt.getBend(surface.data.direction, surface.tileX, surface.tileY, parentX, parentY);
        return {
            id: surface.id,
            type: surface.data.type.beltKind,
            direction: surface.data.direction,
            straight: bend === BeltBend.STRAIGHT,
        };
    }

    /**
     * Whether a mouth facing `direction` can overwrite the belt: only a straight normal belt on the mouth's axis.
     * @private
     * @returns {boolean}
     */
    _overwritable(belt, direction) {
        if (belt.type !== BELT_NORMAL || !belt.straight) {
            return false;
        }
        return belt.direction === direction || belt.direction === Direction.invert(direction);
    }

    /**
     * The ObjectType a resolved placement's mouth sends.
     * @private
     * @returns {ObjectType}
     */
    _mouthDefinition(placement) {
        if (placement.type === BELT_TUNNEL_UP) {
            return BeltTunnelUpDefinition;
        }
        return BeltTunnelDownDefinition;
    }

    /**
     * Whether the tile sits outside buildable chunks, a mod vetoes the mouth, or a surface belt
     * blocks it (unless it's an overwritable same-axis belt).
     * @private
     * @returns {boolean}
     */
    _blocked(tileX, tileY, placement) {
        if (!this._client.canBuildAt(tileX, tileY)) {
            return true;
        }
        if (!this._client.modsAllowPlacement(this._mouthDefinition(placement), tileX, tileY, placement.direction)) {
            return true;
        }
        // A non-belt surface object blocks outright.
        const occupant = this._cache.at(tileX, tileY, LAYER_SURFACE);
        if (occupant !== null && !isBeltType(occupant.data.type)) {
            return true;
        }
        const belt = this._surfaceBeltAt(tileX, tileY);
        return belt !== null && !this._overwritable(belt, placement.direction);
    }

    /**
     * Places one mouth, pairing it with the mouth the tool faces, then flips the facing 180° for the next tap.
     * @private
     */
    _placeTunnelMouth(tileX, tileY, direction) {
        // The server would drop an ungated or mod-vetoed placement anyway.
        if (!this._client.canBuildAt(tileX, tileY)) {
            return;
        }
        const placement = this._resolvePlacement(tileX, tileY, direction);
        if (!this._client.modsAllowPlacement(this._mouthDefinition(placement), tileX, tileY, placement.direction)) {
            return;
        }

        const existing = this._surfaceBeltAt(tileX, tileY);
        if (existing !== null) {
            if (!this._overwritable(existing, placement.direction)) {
                return;
            }
            // Client removes the same-axis belt before laying the mouth.
            this.session.sendMessage(new DeleteObjectMessage(existing.id));
        }

        // Tunnel span is derived sim-side; only the mouth is sent.
        const mouthType = this._mouthDefinition(placement);
        this.session.sendMessage(new CreateObjectMessage(
            mouthType.typeId,
            tileX,
            tileY,
            placement.direction,
        ));
        Haptics.tap();

        this._rotation.invert();
        // Advance the center-lock crosshair: a lone entrance two tiles, a completed tunnel one.
        const completesTunnel = placement.type === BELT_TUNNEL_UP && placement.parentId !== null;
        const loneEntrance = placement.type === BELT_TUNNEL_DOWN && placement.parentId === null;
        if (loneEntrance) {
            this._client.centerLock.advance(tileX, tileY, placement.direction, 2);
        }
        else if (completesTunnel) {
            this._client.centerLock.advance(tileX, tileY, placement.direction);
        }
        this.onTileEnter(tileX, tileY);
    }

    /**
     * Decides what a tap places: a TUNNEL_DOWN into a downstream exit, a TUNNEL_UP back to an upstream entrance, or a lone entrance.
     * @private
     * @returns {{type: BeltType, parentId: number|null, direction: Direction}}
     */
    _resolvePlacement(tileX, tileY, direction) {
        const downstreamExit = this._findTunnelParent(tileX, tileY, direction, BELT_TUNNEL_DOWN);
        if (downstreamExit !== null) {
            return {type: BELT_TUNNEL_DOWN, parentId: downstreamExit, direction};
        }
        const inverted = Direction.invert(direction);
        const upstreamEntrance = this._findTunnelParent(tileX, tileY, inverted, BELT_TUNNEL_UP);
        if (upstreamEntrance !== null) {
            return {type: BELT_TUNNEL_UP, parentId: upstreamEntrance, direction: inverted};
        }
        return {type: BELT_TUNNEL_DOWN, parentId: null, direction};
    }

    /**
     * Scans along the facing axis for the opposite mouth a `type` mouth here would tunnel to.
     * @private
     * @returns {number|null} the paired mouth's id
     */
    _findTunnelParent(tileX, tileY, direction, type) {
        const belt = findTunnelPartner(tileX, tileY, direction, type, (x, y) => this._beltCandidatesAt(x, y));
        if (belt === null) {
            return null;
        }
        return belt.id;
    }

    /**
     * The buried belts laid between the new mouth and its matched `parentId` (empty when adjacent).
     * @private
     * @returns {{x: number, y: number}[]}
     */
    _undergroundTilesFor(parentId, tileX, tileY, type, direction) {
        const parent = this._cache.get(parentId);
        if (parent === null) {
            return [];
        }
        return getUndergroundBeltsToCreate(
            {x: parent.tileX, y: parent.tileY, type: parent.data.type.beltKind, direction},
            {x: tileX, y: tileY, type, direction},
        );
    }
}

import {AbstractTool, Direction, Haptics, OCCUPANCY_LAYER_SURFACE, DeleteObjectMessage} from "@/sdk/client.js";
import {CreateBeltMessage} from "./messages.js";
import {BeltType, BeltBend, MAX_UNDERGROUND_LENGTH} from "./constants.js";
import {BeltDefinition} from "./definitions.js";
import {Belt} from "./BeltLayer.js";
import {getUndergroundBeltsToCreate, surfaceBeltAt, tunnelStep, inferBeltParent} from "./geometry.js";

/**
 * Rotatable single-ramp tool that drops one ramp per tap, pairing it with the ramp it tunnels to.
 */
export class UndergroundBeltTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {BeltGhostLayer} ghostLayer
     */
    constructor(client, ghostLayer) {
        super(client.session);
        this._client = client;
        this._cache = client.cache;
        this._ghostLayer = ghostLayer;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._rotation = client.toolRotation;
    }

    get label() {
        return "Underground";
    }

    onTap(tileX, tileY) {
        this._placeRamp(tileX, tileY, this._rotation.direction);
    }

    onTileEnter(tileX, tileY) {
        const placement = this._resolvePlacement(tileX, tileY, this._rotation.direction);
        const blocked = this._blocked(tileX, tileY, placement.direction);
        this._placementFeedbackLayer.show(blocked ? [{x: tileX, y: tileY}] : []);
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
        // No-op: underground belts are placed one tile at a time via tap, never by
        // dragging across tiles.
    }

    /**
     * Any belt at a tile (surface or underground), or null — the pairing scan needs undergrounds too.
     * @private
     * @returns {{id: BigInt, type: BeltType, direction: Direction}|null}
     */
    _beltAt(tileX, tileY) {
        const record = this._cache.getAtTile(tileX, tileY).find(other => other.data.definition === BeltDefinition);
        if (record === undefined) {
            return null;
        }
        return {id: record.id, type: record.data.type, direction: record.data.direction};
    }

    /**
     * The surface belt at the tile (with a `straight` flag), or null.
     * @private
     * @returns {{id: BigInt, type: BeltType, direction: Direction, straight: boolean}|null}
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
            type: surface.data.type,
            direction: surface.data.direction,
            straight: bend === BeltBend.STRAIGHT,
        };
    }

    /**
     * Whether an existing surface belt can be overwritten by a ramp facing
     * `direction`: only a straight normal belt laid along the ramp's axis (same or
     * inverse facing) qualifies, since the client deletes it before placing the ramp.
     * @private
     * @returns {boolean}
     */
    _overwritable(belt, direction) {
        if (belt.type !== BeltType.NORMAL || !belt.straight) {
            return false;
        }
        return belt.direction === direction || belt.direction === Direction.invert(direction);
    }

    /**
     * Whether a surface belt blocks a ramp facing `direction` (unless it's an overwritable same-axis belt).
     * @private
     * @returns {boolean}
     */
    _blocked(tileX, tileY, direction) {
        // A non-belt surface object (e.g. a splitter) the ramp can't replace blocks outright.
        const occupant = this._cache.at(tileX, tileY, OCCUPANCY_LAYER_SURFACE);
        if (occupant !== null && occupant.data.definition !== BeltDefinition) {
            return true;
        }
        const belt = this._surfaceBeltAt(tileX, tileY);
        return belt !== null && !this._overwritable(belt, direction);
    }

    /**
     * Places one ramp, pairing it with the ramp the tool faces, then flips the facing 180° for the next tap.
     * @private
     */
    _placeRamp(tileX, tileY, direction) {
        const placement = this._resolvePlacement(tileX, tileY, direction);

        const existing = this._surfaceBeltAt(tileX, tileY);
        if (existing !== null) {
            if (!this._overwritable(existing, placement.direction)) {
                return;
            }
            // Overwrite: the client removes the same-axis belt before laying the ramp.
            this.session.sendMessage(new DeleteObjectMessage(existing.id));
        }

        this.session.sendMessage(new CreateBeltMessage(
            tileX,
            tileY,
            placement.direction,
            placement.type,
            placement.parentId === null ? undefined : placement.parentId,
            placement.childId === null ? undefined : placement.childId,
        ));
        Haptics.tap();

        this._rotation.invert();
        // Pan the center-lock crosshair forward along the flow direction so building
        // continues from where the belt resumes. A lone down ramp (entrance) advances
        // two tiles, clearing room for the exit; an up ramp (exit) completing a tunnel
        // back to an existing down ramp advances one. A no-op off center-lock.
        const completesTunnel = placement.type === BeltType.RAMP_UP && placement.parentId !== null;
        const loneEntrance = placement.type === BeltType.RAMP_DOWN && placement.parentId === null;
        if (loneEntrance) {
            this._client.advanceCenterLock(tileX, tileY, placement.direction, 2);
        }
        else if (completesTunnel) {
            this._client.advanceCenterLock(tileX, tileY, placement.direction);
        }
        this.onTileEnter(tileX, tileY);
    }

    /**
     * Decides what a tap places: a RAMP_DOWN into a downstream exit, a RAMP_UP back to an upstream entrance, or a lone entrance.
     * @private
     * @returns {{type: BeltType, parentId: BigInt|null, childId: BigInt|null, direction: Direction}}
     */
    _resolvePlacement(tileX, tileY, direction) {
        const downstreamExit = this._findRampParent(tileX, tileY, direction, BeltType.RAMP_DOWN);
        if (downstreamExit.parentId !== null) {
            return {type: BeltType.RAMP_DOWN, parentId: downstreamExit.parentId, childId: downstreamExit.childId, direction};
        }
        const inverted = Direction.invert(direction);
        const upstreamEntrance = this._findRampParent(tileX, tileY, inverted, BeltType.RAMP_UP);
        if (upstreamEntrance.parentId !== null) {
            return {type: BeltType.RAMP_UP, parentId: upstreamEntrance.parentId, childId: upstreamEntrance.childId, direction: inverted};
        }
        return {type: BeltType.RAMP_DOWN, parentId: null, childId: null, direction};
    }

    /**
     * Scans along the facing axis for the opposite ramp a ramp of `type` placed
     * at (tileX, tileY) would tunnel to, plus any same-type ramp already paired
     * with it that must be disconnected first.
     * @private
     * @returns {{parentId: BigInt|null, childId: BigInt|null}}
     */
    _findRampParent(tileX, tileY, direction, type) {
        // An exit (RAMP_UP) tunnels back toward its entrance, so it scans the
        // opposite way along the axis.
        const {dx, dy} = tunnelStep(type, direction);

        const parentType = type === BeltType.RAMP_UP ? BeltType.RAMP_DOWN : BeltType.RAMP_UP;
        const childType = type === BeltType.RAMP_UP ? BeltType.RAMP_UP : BeltType.RAMP_DOWN;

        let x = tileX;
        let y = tileY;
        let parent = null;
        for (let i = 1; i < MAX_UNDERGROUND_LENGTH + 2; i += 1) {
            x += dx;
            y += dy;
            const belt = this._beltAt(x, y);
            if (belt !== null && belt.type === childType) {
                // A same-type ramp blocks the way: no valid pairing.
                return {parentId: null, childId: null};
            }
            // A tunnel's two ramps must face the same way; a parent-type ramp
            // pointing elsewhere isn't a valid pairing (the engine would reject
            // it), so keep scanning past it.
            if (belt !== null && belt.type === parentType && belt.direction === direction) {
                parent = belt;
                break;
            }
        }

        if (parent === null) {
            return {parentId: null, childId: null};
        }

        // Walk back from the parent looking for its current child, which this new
        // ramp replaces and must therefore be disconnected. The nearest same-type
        // ramp to the parent is that child — only buried belts sit between a ramp
        // pair — so stop at the first one rather than scanning on into an unrelated
        // ramp beyond tunnelling range.
        let childId = null;
        for (let i = 1; i < MAX_UNDERGROUND_LENGTH + 2; i += 1) {
            x -= dx;
            y -= dy;
            const belt = this._beltAt(x, y);
            if (belt !== null && belt.type === parentType) {
                break;
            }
            if (belt !== null && belt.type === childType) {
                childId = belt.id;
                break;
            }
        }

        return {parentId: parent.id, childId};
    }

    /**
     * The buried belts laid between the new ramp and its matched `parentId` (empty when adjacent).
     * @private
     * @returns {{x: number, y: number}[]}
     */
    _undergroundTilesFor(parentId, tileX, tileY, type, direction) {
        const parent = this._cache.get(parentId);
        if (parent === null) {
            return [];
        }
        return getUndergroundBeltsToCreate(
            {x: parent.tileX, y: parent.tileY, type: parent.data.type, direction},
            {x: tileX, y: tileY, type, direction},
        );
    }
}

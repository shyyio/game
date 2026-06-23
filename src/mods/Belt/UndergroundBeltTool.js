import {Tool, Direction} from "@/sdk/client.js";
import {CreateBeltMessage} from "./messages.js";
import {BeltType, MAX_UNDERGROUND_LENGTH} from "./constants.js";

/**
 * Places underground belts as a rotatable single-ramp tool. Each tap drops one
 * ramp facing the tool's current direction; the client scans the world to decide
 * whether that ramp pairs with an existing opposite ramp (becoming the exit of a
 * tunnel) or stands alone (an entrance). The facing is rotated via the radial
 * direction wheel (long-press), which arrives as onLongTap and also places.
 *
 * The pairing scan is ported from the old buildSystem/ClientState.findRampParent.
 */
export class UndergroundBeltTool extends Tool {

    /**
     * @param {Session} session
     * @param {Game} game
     * @param {BeltGhostLayer} ghostLayer
     */
    constructor(session, game, ghostLayer) {
        super(session, game);
        this._ghostLayer = ghostLayer;
        this._direction = Direction.RIGHT;
        // The ramp the next tap will place. Alternates entrance/exit as a tunnel
        // is built, resetting to an entrance once a pair completes.
        this._nextType = BeltType.RAMP_DOWN;
    }

    get label() {
        return "Underground";
    }

    onTap(tileX, tileY) {
        this._placeRamp(tileX, tileY, this._direction);
    }

    onLongTap(tileX, tileY, direction) {
        this._direction = direction;
        this._placeRamp(tileX, tileY, direction);
    }

    onTileEnter(tileX, tileY) {
        this._ghostLayer.showGhost(tileX, tileY, this._direction, this._nextType);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
    }

    onDragTile(tileX, tileY, direction) {
        // No-op: underground belts are placed one tile at a time via tap / long-tap
        // (with the direction wheel), never by dragging across tiles.
    }

    rotate() {
        this._direction = Direction.rotate(this._direction, 1);
    }

    /**
     * Places one ramp facing `direction`, auto-pairing it with an existing
     * opposite ramp if one is within tunnel range, and advances _nextType.
     * @private
     */
    _placeRamp(tileX, tileY, direction) {
        const type = this._nextType;
        const {parentId, childId} = this._findRampParent(tileX, tileY, direction, type);

        this.session.sendMessage(new CreateBeltMessage({
            x: tileX,
            y: tileY,
            direction,
            beltType: type,
            rampParent: parentId === null ? undefined : parentId,
            disconnectRampChild: childId === null ? undefined : childId,
        }));

        if (parentId === null) {
            // Placed a lone ramp; the next tap lays down its counterpart.
            this._nextType = type === BeltType.RAMP_DOWN ? BeltType.RAMP_UP : BeltType.RAMP_DOWN;
        } else {
            // The pair (and its tunnel) is complete; start fresh.
            this._nextType = BeltType.RAMP_DOWN;
        }
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
        const dx = type === BeltType.RAMP_UP ? -Direction.dx(direction) : Direction.dx(direction);
        const dy = type === BeltType.RAMP_UP ? -Direction.dy(direction) : Direction.dy(direction);

        const parentType = type === BeltType.RAMP_UP ? BeltType.RAMP_DOWN : BeltType.RAMP_UP;
        const childType = type === BeltType.RAMP_UP ? BeltType.RAMP_UP : BeltType.RAMP_DOWN;

        let x = tileX;
        let y = tileY;
        let parent = null;
        for (let i = 1; i < MAX_UNDERGROUND_LENGTH + 2; i += 1) {
            x += dx;
            y += dy;
            const belt = this.game.querySingle("GetBeltTypeAtTile", {x, y});
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

        // Walk back toward the placement looking for the parent's current child,
        // which this new ramp replaces and must therefore be disconnected.
        let childId = null;
        for (let i = 1; i < MAX_UNDERGROUND_LENGTH + 2; i += 1) {
            x -= dx;
            y -= dy;
            const belt = this.game.querySingle("GetBeltTypeAtTile", {x, y});
            if (belt !== null && belt.type === parentType) {
                break;
            }
            if (belt !== null && belt.type === childType) {
                childId = belt.id;
            }
        }

        return {parentId: parent.id, childId};
    }
}

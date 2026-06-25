import {AbstractTool, Direction, Haptics} from "@/sdk/client.js";
import {CreateBeltMessage, DeleteBeltMessage} from "./messages.js";
import {BeltType, BeltBend} from "@/mods/Belt/constants.js";
import {Belt} from "./BeltLayer.js";
import {surfaceBeltAt} from "./geometry.js";

export class BeltTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {ViewportCache} beltCache
     * @param {BeltGhostLayer} ghostLayer
     */
    constructor(client, beltCache, ghostLayer) {
        super(client.session);
        this._client = client;
        this._beltCache = beltCache;
        this._ghostLayer = ghostLayer;
        this._blockedTilesLayer = client.blockedTilesLayer;
        this._rotation = client.toolRotation;
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        this._firstDragStep = false;
    }

    get label() {
        return "Belt";
    }

    onTap(tileX, tileY) {
        const direction = this._rotation.direction;
        const blocked = this._blocked(tileX, tileY);
        this._place(tileX, tileY, direction);
        if (!blocked) {
            // A placed belt advances the center-lock crosshair one tile along the
            // belt, so quick consecutive taps lay a line. A no-op off center-lock.
            this._client.advanceCenterLock(tileX, tileY, direction);
        }
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._rotation.direction);
    }

    /**
     * Draws the placement ghost facing `direction`, bent from its inferred parent, marking the tile if blocked.
     * @private
     */
    _showGhost(tileX, tileY, direction) {
        const blocked = this._blocked(tileX, tileY);
        this._blockedTilesLayer.show(blocked ? [{x: tileX, y: tileY}] : []);
        const bend = this._inferBend(tileX, tileY, direction);
        this._ghostLayer.showGhost(tileX, tileY, direction, BeltType.NORMAL, bend, blocked);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._blockedTilesLayer.clear();
    }

    onDragStart(tileX, tileY) {
        this._firstDragStep = true;
    }

    /**
     * Whether a surface belt the tool can't overwrite (anything but a normal belt) blocks the tile.
     * @private
     * @returns {boolean}
     */
    _blocked(tileX, tileY) {
        const existing = surfaceBeltAt(this._beltCache, tileX, tileY);
        return existing !== null && existing.data.type !== BeltType.NORMAL;
    }

    /**
     * The bend a belt placed here facing `direction` would take from its inferred upstream parent.
     * @private
     * @returns {BeltBend}
     */
    _inferBend(tileX, tileY, direction) {
        // Mirrors upstreamParentSql (statements.js): highest-id NORMAL/RAMP_UP neighbour
        // pointing into this tile wins (the tile behind, or the two perpendicular tiles).
        const candidates = [
            {x: tileX - Direction.dx(direction), y: tileY - Direction.dy(direction), facing: direction},
        ];
        [Direction.rotate(direction, 1), Direction.rotate(direction, 3)].forEach(perpendicular => {
            candidates.push({
                x: tileX + Direction.dx(perpendicular),
                y: tileY + Direction.dy(perpendicular),
                facing: Direction.invert(perpendicular),
            });
        });

        let parent = null;
        candidates.forEach(candidate => {
            const records = this._beltCache.getAtTile(candidate.x, candidate.y);
            records.forEach(record => {
                if (record.data.direction !== candidate.facing) {
                    return;
                }
                if (record.data.type !== BeltType.NORMAL && record.data.type !== BeltType.RAMP_UP) {
                    return;
                }
                if (parent === null || record.id > parent.id) {
                    parent = record;
                }
            });
        });

        if (parent === null) {
            return BeltBend.STRAIGHT;
        }
        return Belt.getBend(direction, tileX, tileY, parent.tileX, parent.tileY);
    }

    /**
     * Places a normal belt at the tile facing `direction`, replacing any belt
     * already there.
     * @private
     */
    _place(tileX, tileY, direction) {
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        this._placeBelt(tileX, tileY, direction);
    }

    /**
     * Lays a normal belt facing `direction`, replacing a normal belt there but leaving a ramp untouched.
     * @private
     */
    _placeBelt(tileX, tileY, direction) {
        const existing = surfaceBeltAt(this._beltCache, tileX, tileY);
        if (existing !== null) {
            if (existing.data.type !== BeltType.NORMAL) {
                return;
            }
            this.session.sendMessage(new DeleteBeltMessage(existing.id));
        }
        this.session.sendMessage(new CreateBeltMessage({x: tileX, y: tileY, direction, beltType: BeltType.NORMAL}));
        Haptics.tap();
    }

    onDragTile(tileX, tileY, direction) {
        const fromTileX = tileX - Direction.dx(direction);
        const fromTileY = tileY - Direction.dy(direction);

        if (this._firstDragStep) {
            // The tile the press started on gets its own belt, facing the drag,
            // so the first drag step lays two belts and every step after lays one.
            this._firstDragStep = false;
            this._placeBelt(fromTileX, fromTileY, direction);
        } else if (direction !== this._rotation.direction && this._prevDragTileX === fromTileX && this._prevDragTileY === fromTileY) {
            // Re-lay the corner tile facing the new direction on a turn.
            this._placeBelt(fromTileX, fromTileY, direction);
        }

        // The drag direction becomes the shared facing, so it carries to the next
        // tap/hover and to other tools.
        this._rotation.direction = direction;
        this._prevDragTileX = tileX;
        this._prevDragTileY = tileY;

        this._placeBelt(tileX, tileY, direction);

        // The hover handler fires alongside the drag with the pre-step direction, so
        // refresh the ghost here to face the actual drag step.
        this._showGhost(tileX, tileY, direction);
    }
}

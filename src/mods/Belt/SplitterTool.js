import {AbstractTool, Direction, Haptics, OCCUPANCY_LAYER_SURFACE, chunkKey} from "@/sdk/client.js";
import {CreateSplitterMessage, DeleteBeltMessage} from "./messages.js";
import {BeltType, OccupantKind} from "./constants.js";
import {splitterFootprint} from "./geometry.js";

/**
 * Rotatable tool that drops one 1x2 splitter per tap.
 */
export class SplitterTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {SplitterGhostLayer} ghostLayer
     */
    constructor(client, ghostLayer) {
        super(client.session);
        this._client = client;
        this._cache = client.cache;
        this._ghostLayer = ghostLayer;
        this._blockedTilesLayer = client.blockedTilesLayer;
        this._rotation = client.toolRotation;
    }

    get label() {
        return "Splitter";
    }

    onTap(tileX, tileY) {
        this._place(tileX, tileY, this._rotation.direction);
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._rotation.direction);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._blockedTilesLayer.clear();
    }

    onDragTile(tileX, tileY, direction) {
        // No-op: a splitter is placed one at a time via tap, never by dragging across tiles.
    }

    /**
     * Inspects the footprint's surface layer: a normal belt running along the splitter's axis
     * is overwritten (it becomes a feed lane), anything else on that layer blocks. A footprint
     * crossing a chunk boundary also blocks (the engine rejects such placements). Undergrounds
     * sit on other layers, so they're ignored and coexist.
     * @private
     * @returns {{blocked: boolean, overwriteIds: BigInt[]}}
     */
    _evaluate(tileX, tileY, direction) {
        const overwriteIds = [];
        let blocked = false;
        const baseChunk = chunkKey(tileX, tileY);
        splitterFootprint(tileX, tileY, direction).forEach(cell => {
            if (chunkKey(cell.x, cell.y) !== baseChunk) {
                blocked = true;
                return;
            }
            const occupant = this._cache.at(cell.x, cell.y, OCCUPANCY_LAYER_SURFACE);
            if (occupant === null) {
                return;
            }
            if (this._overwritable(occupant, direction)) {
                overwriteIds.push(occupant.id);
            } else {
                blocked = true;
            }
        });
        return {blocked, overwriteIds};
    }

    /**
     * Whether a surface occupant is a normal belt aligned with the splitter's axis, so the
     * tool may delete it and lay the splitter over it as a feed lane. Ramps and other
     * non-normal belts are left untouched (they block instead).
     * @private
     * @returns {boolean}
     */
    _overwritable(occupant, direction) {
        return occupant.data.kind === OccupantKind.BELT
            && occupant.data.type === BeltType.NORMAL
            && Direction.axis(occupant.data.direction) === Direction.axis(direction);
    }

    /**
     * Draws the ghost over both footprint tiles, marking them if blocked.
     * @private
     */
    _showGhost(tileX, tileY, direction) {
        const {blocked} = this._evaluate(tileX, tileY, direction);
        this._blockedTilesLayer.show(blocked ? splitterFootprint(tileX, tileY, direction) : []);
        this._ghostLayer.showGhost(tileX, tileY, direction, blocked);
    }

    /**
     * Places a splitter, first deleting any collinear belts its footprint overwrites.
     * @private
     */
    _place(tileX, tileY, direction) {
        const {blocked, overwriteIds} = this._evaluate(tileX, tileY, direction);
        if (blocked) {
            return;
        }
        overwriteIds.forEach(id => this.session.sendMessage(new DeleteBeltMessage(id)));
        this.session.sendMessage(new CreateSplitterMessage({x: tileX, y: tileY, direction}));
        Haptics.tap();
        this._showGhost(tileX, tileY, direction);
    }
}

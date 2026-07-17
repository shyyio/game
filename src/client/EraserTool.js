import {AbstractTool} from "@/client/AbstractTool.js";
import {Direction, SURFACE_LAYER} from "@/common/constants.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import Haptics from "@/client/Haptics.js";

/**
 * Paint-eraser: a tap or drag deletes the surface object on each tile touched, any type. Only
 * surface objects, so buried undergrounds are untouched (their ramp is the deletable surface).
 */
export class EraserTool extends AbstractTool {

    /**
     * @param {Client} client
     */
    constructor(client) {
        super(client.session);
        this._cache = client.cache;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._firstDragStep = false;
    }

    get label() {
        return "Eraser";
    }

    get hotkey() {
        return "e";
    }

    get textureName() {
        // Placeholder
        return "inspect/1x1";
    }

    get usesCenterLock() {
        return false;
    }

    onTap(tileX, tileY) {
        this._erase(tileX, tileY);
    }

    onDragStart(tileX, tileY) {
        this._firstDragStep = true;
    }

    onTileEnter(tileX, tileY) {
        const occupied = this._cache.at(tileX, tileY, SURFACE_LAYER) !== null;
        this._placementFeedbackLayer.show({blocked: occupied ? [{x: tileX, y: tileY}] : []});
    }

    onTileExit(tileX, tileY) {
        this._placementFeedbackLayer.clear();
    }

    onDragTile(tileX, tileY, direction) {
        if (this._firstDragStep) {
            // Erase the press-origin tile too, so the first step clears both ends.
            this._firstDragStep = false;
            this._erase(tileX - Direction.dx(direction), tileY - Direction.dy(direction));
        }
        this._erase(tileX, tileY);
    }

    /**
     * Deletes the surface object covering (tileX, tileY), if any.
     * @private
     */
    _erase(tileX, tileY) {
        const target = this._cache.at(tileX, tileY, SURFACE_LAYER);
        if (target === null) {
            return;
        }
        this.session.sendMessage(new DeleteObjectMessage(target.id));
        // Drop the highlight; the tile clears once the in-flight delete lands.
        this._placementFeedbackLayer.clear();
        Haptics.tap();
    }
}

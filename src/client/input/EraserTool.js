import {AbstractTool} from "@/client/input/AbstractTool.js";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import Haptics from "@/client/Haptics.js";

/**
 * Paint-eraser: a tap or drag deletes every surface object on each tile touched, any type. Only
 * surface objects, so buried undergrounds are untouched (their mouth is the deletable surface).
 */
export class EraserTool extends AbstractTool {

    /**
     * @param {Client} client
     */
    constructor(client) {
        super(client.session);
        this._client = client;
        this._cache = client.objects;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._firstDragStep = false;
    }

    get label() {
        return "Eraser";
    }

    get id() {
        return 1;
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
        // Mirrors the sim's delete gate: no erasing outside buildable chunks.
        const erasable = this._client.canBuildAt(tileX, tileY)
            && this._cache.at(tileX, tileY, LAYER_SURFACE) !== null;
        let blocked;
        if (erasable) {
            blocked = [{x: tileX, y: tileY}];
        } else {
            blocked = [];
        }
        this._placementFeedbackLayer.show({blocked});
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
     * Deletes every surface object stacked on (tileX, tileY), if any (an extractor and the
     * non-solid resource beneath it go together).
     * @private
     */
    _erase(tileX, tileY) {
        if (!this._client.canBuildAt(tileX, tileY)) {
            return;
        }
        const targets = this._cache.allAt(tileX, tileY, LAYER_SURFACE);
        if (targets.length === 0) {
            return;
        }
        for (const target of targets) {
            this.session.sendMessage(new DeleteObjectMessage(target.id));
        }
        // Drop the highlight; the tile clears once the in-flight delete lands.
        this._placementFeedbackLayer.clear();
        Haptics.tap();
    }
}

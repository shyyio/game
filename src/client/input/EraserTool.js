import {AbstractTool} from "@/client/input/AbstractTool.js";
import {Direction} from "@/common/constants.js";
import {LANE_LAYERS_HIGHEST_FIRST} from "@/sim/LaneIndex.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import Haptics from "@/client/Haptics.js";

/**
 * Paint-eraser: a tap or drag deletes, on each tile touched, every object on the highest layer
 * holding one, any type. Buried undergrounds are untouched; their mouth is what a player deletes.
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
            && this._isErasableAt(tileX, tileY);
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
     * Whether any layer holds something the tap would delete.
     * @private
     * @returns {boolean}
     */
    _isErasableAt(tileX, tileY) {
        for (const layer of LANE_LAYERS_HIGHEST_FIRST) {
            if (this._cache.getObjectAtOrNull(tileX, tileY, layer) !== null) {
                return true;
            }
        }
        return false;
    }

    /**
     * The objects a tap on (tileX, tileY) deletes: the stack on the highest layer holding one, so
     * an elevated run goes before the ground it passes over.
     * @private
     * @returns {CacheEntry[]}
     */
    _getTargetsAt(tileX, tileY) {
        for (const layer of LANE_LAYERS_HIGHEST_FIRST) {
            const targets = this._cache.getObjectsAt(tileX, tileY, layer);
            if (targets.length > 0) {
                return targets;
            }
        }
        return [];
    }

    /**
     * Deletes the objects stacked on the tile's highest occupied layer, if any (an extractor and
     * the non-solid resource beneath it go together).
     * @private
     */
    _erase(tileX, tileY) {
        if (!this._client.canBuildAt(tileX, tileY)) {
            return;
        }
        const targets = this._getTargetsAt(tileX, tileY);
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

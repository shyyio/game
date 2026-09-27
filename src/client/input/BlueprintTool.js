import {AbstractTool, ToolActionEntry} from "@/client/input/AbstractTool.js";
import {KEYBINDING_PASTE, KEYBINDING_BLUEPRINT_OLDER, KEYBINDING_BLUEPRINT_NEWER} from "@/common/KeybindingEntry.js";
import {Direction} from "@/common/constants.js";
import {DeleteObjectMessage, PlaceBlueprintMessage, MAX_BLUEPRINT_ENTRIES} from "@/common/CoreMessages.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import Keyboard from "@/client/input/Keyboard.js";
import Mobile from "@/client/Mobile.js";
import Haptics from "@/client/Haptics.js";
import {evaluatePlacement} from "@/client/input/placementEvaluation.js";
import {getLimitReachedReason} from "@/client/input/placementBlockedReasons.js";
import {
    GHOST_ENTRY_STATE_CLEAR,
    GHOST_ENTRY_STATE_BLOCKED,
    GHOST_ENTRY_STATE_SKIPPED,
    FORCE_PASTE_KEY,
} from "@/client/layers/BlueprintGhostLayer.js";

const NOTHING_COPIED = "Nothing copied";
// Undo places a paste's overwrites back in one message.
const BLOCKED_REASON_OVERWRITES_TOO_MANY = "Overwrites too many objects";

/**
 * @typedef {Object} BlueprintPlacement
 * @property {GhostEntryState[]} states one per entry
 * @property {Point[]} blockedCells
 * @property {Point[]} overwriteCells
 * @property {Point[]} clearCells
 * @property {number[]} overwriteIds the occupants the placeable entries overwrite
 * @property {string|null} blockedReason the first blocked entry's reason, null when none is blocked
 * @property {Point|null} blockedTile where that entry lands
 */

/**
 * Pastes the blueprint history's selected blueprint: the blueprint ghost snaps under the cursor,
 * every entry is evaluated on its own, and a tap places them all through one message. One blocked entry blocks the paste unless
 * the force key is held, which skips the blocked entries instead.
 */
export class BlueprintTool extends AbstractTool {

    /**
     * @param {Client} client
     */
    constructor(client) {
        super(client.session);
        this._client = client;
        this._ghostLayer = client.blueprintGhostLayer;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        // The selected blueprint as turned by the player.
        this._blueprint = null;
        this._blueprintRotation = Direction.UP;
        this._ghostLayer.setFollowCursor((anchorX, anchorY) => this._previewFollow(anchorX, anchorY));
    }

    get label() {
        return "Paste";
    }

    get id() {
        return 41;
    }

    get keybinding() {
        return KEYBINDING_PASTE;
    }

    get textureName() {
        // Placeholder
        return "inspect/1x1";
    }

    get paintsOnDrag() {
        return false;
    }

    get orientable() {
        return this._blueprint !== null;
    }

    get statusText() {
        if (this._blueprint === null) {
            return NOTHING_COPIED;
        }
        const blueprints = this._client.blueprints;
        const position = `${blueprints.selectedPosition}/${blueprints.count}`;
        if (Mobile.isEnabled) {
            return `Tap to paste ${position}`;
        }
        return `Paste ${position} [Click], skip blocked [${FORCE_PASTE_KEY}+Click]`;
    }

    get actions() {
        return [
            new ToolActionEntry("Older", KEYBINDING_BLUEPRINT_OLDER, () => this._selectOlder()),
            new ToolActionEntry("Newer", KEYBINDING_BLUEPRINT_NEWER, () => this._selectNewer()),
        ];
    }

    onActivate() {
        this._blueprintRotation = Direction.UP;
        this._applySelected();
    }

    onDeactivate() {
        this._blueprint = null;
        this._ghostLayer.clear();
        this._placementFeedbackLayer.clear();
    }

    rotate(rotation) {
        if (this._blueprint === null) {
            return;
        }
        this._blueprintRotation = Direction.rotate(this._blueprintRotation, rotation);
        this._applySelected();
    }

    onTileEnter(tileX, tileY) {
        if (this._blueprint === null) {
            return;
        }
        this._ghostLayer.show(this._blueprint);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.hide();
        this._placementFeedbackLayer.clear();
    }

    onTap(tileX, tileY) {
        const anchor = this._ghostLayer.snapAnchor();
        if (anchor === null) {
            return;
        }
        const isForced = Keyboard.isKeyDown(FORCE_PASTE_KEY);
        const placement = this._evaluate(anchor.x, anchor.y, isForced);
        if (!isForced && placement.blockedReason !== null) {
            this._client.drawPlacementBlockedReason(placement.blockedTile.x, placement.blockedTile.y, placement.blockedReason);
            return;
        }
        const entries = this._blueprint.entries.filter((entry, index) => placement.states[index] === GHOST_ENTRY_STATE_CLEAR);
        if (entries.length === 0) {
            return;
        }
        const overwritten = placement.overwriteIds.map(id => this._client.objects.get(id));
        for (const id of placement.overwriteIds) {
            this.session.sendMessage(new DeleteObjectMessage(id));
        }
        this.session.sendMessage(new PlaceBlueprintMessage(anchor.x, anchor.y, new Blueprint(entries)));
        this._client.undo.add(
            new Blueprint(entries.map(entry => new BlueprintEntry(entry.objectTypeId, anchor.x + entry.tileX, anchor.y + entry.tileY, entry.direction))),
            overwritten,
        );
        Haptics.tap();
        // Re-evaluate next frame so the just-placed tiles now read as occupied.
        this._ghostLayer.invalidateSnap();
    }

    /**
     * @private
     * @returns {void}
     */
    _selectOlder() {
        if (this._client.blueprints.selectOlder()) {
            this._applySelected();
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _selectNewer() {
        if (this._client.blueprints.selectNewer()) {
            this._applySelected();
        }
    }

    /**
     * Takes the history's selected blueprint, turned by the player's rotation.
     * @private
     * @returns {void}
     */
    _applySelected() {
        const selected = this._client.blueprints.selected;
        if (selected === null) {
            this._blueprint = null;
        } else {
            this._blueprint = selected.rotate(this._blueprintRotation, this._client.modRegistry);
        }
    }

    /**
     * Repaints the placement feedback as the ghost snaps; returns each entry's state for its tint.
     * @private
     * @param {number} anchorX
     * @param {number} anchorY
     * @returns {GhostEntryState[]}
     */
    _previewFollow(anchorX, anchorY) {
        const placement = this._evaluate(anchorX, anchorY, Keyboard.isKeyDown(FORCE_PASTE_KEY));
        this._placementFeedbackLayer.show({
            blocked: placement.blockedCells,
            overwrite: placement.overwriteCells,
            clear: placement.clearCells,
            shouldShowTarget: true,
        });
        return placement.states;
    }

    /**
     * Evaluates every entry at the anchor. A blocked entry is skipped when forced, otherwise it
     * blocks the paste; a type's remaining placements cap how many of its entries are placeable, and
     * `MAX_BLUEPRINT_ENTRIES` how many objects they overwrite.
     * @private
     * @param {number} anchorX
     * @param {number} anchorY
     * @param {boolean} isForced
     * @returns {BlueprintPlacement}
     */
    _evaluate(anchorX, anchorY, isForced) {
        const limits = this._client.cache.view("placementLimits");
        const placedByTypeId = new Map();
        const overwriteIds = new Set();
        const placement = {
            states: [],
            blockedCells: [],
            overwriteCells: [],
            clearCells: [],
            overwriteIds: [],
            blockedReason: null,
            blockedTile: null,
        };
        for (const entry of this._blueprint.entries) {
            const type = this._client.modRegistry.getObjectTypeByTypeId(entry.objectTypeId);
            const tileX = anchorX + entry.tileX;
            const tileY = anchorY + entry.tileY;
            const cells = evaluatePlacement(this._client, type, tileX, tileY, entry.direction);
            if (cells.isAlreadyPlaced) {
                placement.states.push(GHOST_ENTRY_STATE_SKIPPED);
                for (const cell of cells.overwriteCells) {
                    placement.overwriteCells.push(cell);
                }
                continue;
            }
            let blockedReason = cells.blockedReason;
            const placed = placedByTypeId.has(type.objectTypeId) ? placedByTypeId.get(type.objectTypeId) : 0;
            if (blockedReason === null && type.initialPlacementLimit !== null && placed >= limits.getRemainingByTypeId(type.objectTypeId)) {
                blockedReason = getLimitReachedReason(type);
            }
            let newOverwriteCount = 0;
            for (const id of cells.overwriteIds) {
                if (!overwriteIds.has(id)) {
                    newOverwriteCount += 1;
                }
            }
            if (blockedReason === null && overwriteIds.size + newOverwriteCount > MAX_BLUEPRINT_ENTRIES) {
                blockedReason = BLOCKED_REASON_OVERWRITES_TOO_MANY;
            }
            if (blockedReason !== null) {
                if (placement.blockedReason === null) {
                    placement.blockedReason = blockedReason;
                    placement.blockedTile = {x: tileX, y: tileY};
                }
                if (isForced) {
                    placement.states.push(GHOST_ENTRY_STATE_SKIPPED);
                } else {
                    placement.states.push(GHOST_ENTRY_STATE_BLOCKED);
                    for (const cell of type.geometry.getTilesByDirection(entry.direction)) {
                        placement.blockedCells.push({x: tileX + cell.x, y: tileY + cell.y});
                    }
                }
                continue;
            }
            placedByTypeId.set(type.objectTypeId, placed + 1);
            placement.states.push(GHOST_ENTRY_STATE_CLEAR);
            for (const cell of cells.overwriteCells) {
                placement.overwriteCells.push(cell);
            }
            for (const cell of cells.clearCells) {
                placement.clearCells.push(cell);
            }
            for (const id of cells.overwriteIds) {
                overwriteIds.add(id);
            }
        }
        placement.overwriteIds = Array.from(overwriteIds);
        return placement;
    }
}

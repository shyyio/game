import {AbstractSelectionTool} from "@/client/input/AbstractSelectionTool.js";
import {KEYBINDING_CUT} from "@/common/KeybindingEntry.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import {buildBlueprint} from "@/client/input/copySelection.js";
import {NOTHING_PLACED} from "@/client/state/UndoCache.js";
import {BLOCKED_TILE_COLOR} from "@/client/Theme.js";

/**
 * Cuts the marquee selection: copies it into the clipboard and deletes it at once. Objects in
 * chunks the player cannot build in are left out, since the sim would refuse their delete.
 */
export class CutTool extends AbstractSelectionTool {

    get label() {
        return "Cut";
    }

    get id() {
        return 42;
    }

    get keybinding() {
        return KEYBINDING_CUT;
    }

    get promptText() {
        return "Drag over the objects to cut";
    }

    get emptySelectionText() {
        return "Nothing to cut";
    }

    get marqueeColor() {
        return BLOCKED_TILE_COLOR;
    }

    get selectionColor() {
        return BLOCKED_TILE_COLOR;
    }

    isSelectable(entry) {
        return this._client.canBuildAt(entry.tileX, entry.tileY);
    }

    applySelection(selected) {
        this._client.undo.add(NOTHING_PLACED, selected);
        this._client.clipboard = buildBlueprint(selected);
        for (const entry of selected) {
            this.session.sendMessage(new DeleteObjectMessage(entry.id));
        }
    }
}

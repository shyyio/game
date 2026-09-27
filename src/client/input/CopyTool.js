import {AbstractSelectionTool} from "@/client/input/AbstractSelectionTool.js";
import {KEYBINDING_COPY} from "@/common/KeybindingEntry.js";
import {buildBlueprint} from "@/client/input/copySelection.js";
import {NOTHING_PLACED} from "@/client/state/UndoCache.js";

/**
 * Copies the marquee selection into the clipboard.
 */
export class CopyTool extends AbstractSelectionTool {

    get label() {
        return "Copy";
    }

    get id() {
        return 40;
    }

    get keybinding() {
        return KEYBINDING_COPY;
    }

    get promptText() {
        return "Drag over the objects to copy";
    }

    get emptySelectionText() {
        return "Nothing to copy";
    }

    applySelection(selected) {
        this._client.undo.add(NOTHING_PLACED, []);
        this._client.clipboard = buildBlueprint(selected);
    }
}

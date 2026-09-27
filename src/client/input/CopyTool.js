import {AbstractSelectionTool} from "@/client/input/AbstractSelectionTool.js";
import {KEYBINDING_COPY} from "@/common/KeybindingEntry.js";
import {buildBlueprint} from "@/client/input/copySelection.js";

/**
 * Copies the marquee selection into the blueprint history.
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
        const blueprint = buildBlueprint(selected);
        this._client.blueprints.push(blueprint);
        this._client.undo.addCopied(blueprint, []);
    }
}

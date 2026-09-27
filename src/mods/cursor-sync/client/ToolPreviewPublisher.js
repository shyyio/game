import {
    CursorSelectionStartMessage,
    CursorSelectionEndMessage,
    CursorPasteMessage,
    CursorPasteClearMessage,
} from "../common/messages.js";

/**
 * Sends each change of the own tool preview; the sim shows it wherever the own cursor shows, so
 * the cursor's gates apply to it there.
 */
export class ToolPreviewPublisher {

    /**
     * @param {AbstractSession} session
     * @param {ToolPreviewCache} toolPreview
     * @param {ModRegistry} modRegistry
     */
    constructor(session, toolPreview, modRegistry) {
        toolPreview.onSelectionChange(selection => {
            if (selection === null) {
                session.sendMessage(new CursorSelectionEndMessage());
            } else {
                session.sendMessage(new CursorSelectionStartMessage(selection.tileX, selection.tileY, selection.toolId));
            }
        });
        toolPreview.onPasteChange(blueprint => {
            if (blueprint === null) {
                session.sendMessage(new CursorPasteClearMessage());
            } else {
                session.sendMessage(new CursorPasteMessage(blueprint, modRegistry));
            }
        });
    }
}

import {AbstractModDeclaration, PlayerSettingEntry} from "@spup/sdk";
import {CURSOR_SETTING_SHARE, CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_OPTIONS} from "./common/constants.js";
import {CursorMoveMessage, CursorHideMessage, CursorSelectionStartMessage, CursorSelectionEndMessage, CursorPasteMessage, CursorPasteClearMessage} from "./common/messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent, PlayerSelectionStartEvent, PlayerSelectionEndEvent, PlayerPasteEvent, PlayerPasteClearEvent} from "./common/events.js";

export class CursorSyncDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "CursorSync";
    }

    get wireClasses() {
        return [
            CursorMoveMessage,
            CursorHideMessage,
            PlayerCursorEvent,
            PlayerCursorHideEvent,
            CursorSelectionStartMessage,
            CursorSelectionEndMessage,
            PlayerSelectionStartEvent,
            PlayerSelectionEndEvent,
            CursorPasteMessage,
            CursorPasteClearMessage,
            PlayerPasteEvent,
            PlayerPasteClearEvent,
        ];
    }

    get playerSettingEntries() {
        return [
            new PlayerSettingEntry(CURSOR_SETTING_SHARE, true, CURSOR_AUDIENCE_OPTIONS.length),
            new PlayerSettingEntry(CURSOR_SETTING_DISPLAY, true, CURSOR_AUDIENCE_OPTIONS.length),
        ];
    }
}

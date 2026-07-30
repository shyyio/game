import {AbstractModDeclaration, PlayerSettingEntry} from "@/sdk/common.js";
import {CURSOR_SETTING_SHARE, CURSOR_SETTING_SHOW, CURSOR_SETTING_EVERYONE} from "./common/constants.js";
import {CursorMoveMessage, CursorHideMessage} from "./common/messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "./common/events.js";

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
        ];
    }

    get playerSettingEntries() {
        return [
            new PlayerSettingEntry(CURSOR_SETTING_SHARE, true),
            new PlayerSettingEntry(CURSOR_SETTING_SHOW, true),
            new PlayerSettingEntry(CURSOR_SETTING_EVERYONE, true),
        ];
    }
}

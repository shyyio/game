import {TILE_SIZE, ViewMode} from "@/sdk/client.js";
import {CursorMoveMessage, CursorHideMessage} from "../common/messages.js";
import {CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_NONE, CURSOR_SEND_INTERVAL_MS} from "../common/constants.js";

/**
 * Broadcasts the own cursor's tile position: one heartbeat per interval while it moves, silence
 * while it rests, an explicit hide on blur, zoom-out, or share-off.
 */
export class CursorPublisher {

    /**
     * @param {AbstractSession} session
     * @param {Mouse} mouse
     * @param {ClientCache} state
     * @param {WindowFocus} windowFocus
     */
    constructor(
        session,
        mouse,
        state,
        windowFocus,
    ) {
        this._session = session;
        this._mouse = mouse;
        this._playerSettings = state.view("playerSettings");
        this._windowFocus = windowFocus;
        this._viewMode = ViewMode.WORLD;
        // Whether the cursor is currently shown remotely (a hide is owed when sending stops).
        this._shown = false;
        this._lastSentX = null;
        this._lastSentY = null;
        state.subscribe("playerSettings.values", (key, value) => {
            // No wire hide: the server erases the cursor on the narrowing share write itself.
            // Forgetting the last position makes the next heartbeat re-show it where allowed.
            if (key === CURSOR_SETTING_SHARE) {
                this._reset();
            }
        });
        windowFocus.onChange(focused => {
            if (!focused) {
                this._hide();
            }
        });
    }

    /**
     * Starts the heartbeat timer (browser only).
     * @returns {void}
     */
    start() {
        window.setInterval(() => this.tick(), CURSOR_SEND_INTERVAL_MS);
    }

    /**
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this._viewMode = mode;
        if (mode !== ViewMode.WORLD) {
            this._hide();
        }
    }

    /**
     * One heartbeat: sends the cursor's tile position when sharing applies and it moved.
     * @returns {void}
     */
    tick() {
        if (!this._canSend() || this._mouse.currentX === null) {
            return;
        }
        const x = this._mouse.currentX / TILE_SIZE;
        const y = this._mouse.currentY / TILE_SIZE;
        if (x === this._lastSentX && y === this._lastSentY) {
            return;
        }
        this._lastSentX = x;
        this._lastSentY = y;
        this._shown = true;
        this._session.sendMessage(new CursorMoveMessage(x, y));
    }

    /**
     * @private
     * @returns {boolean}
     */
    _canSend() {
        return this._windowFocus.focused
            && this._viewMode === ViewMode.WORLD
            && this._playerSettings.get(CURSOR_SETTING_SHARE) !== CURSOR_AUDIENCE_NONE;
    }

    /**
     * Sends one hide when the cursor was shown; the next heartbeat re-shows it.
     * @private
     * @returns {void}
     */
    _hide() {
        const shown = this._shown;
        this._reset();
        if (shown) {
            this._session.sendMessage(new CursorHideMessage());
        }
    }

    /**
     * Forgets the shown cursor without a wire hide; the next heartbeat re-shows it.
     * @private
     * @returns {void}
     */
    _reset() {
        this._shown = false;
        this._lastSentX = null;
        this._lastSentY = null;
    }
}

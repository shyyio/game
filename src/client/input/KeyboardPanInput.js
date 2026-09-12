import Keyboard from "@/client/input/Keyboard.js";
import {PAN_KEYS, keyboardPanOffset} from "@/client/input/viewportPan.js";

/**
 * Pans the viewport from the held W/A/S/D keys, one step per rendered frame. A key the active
 * tool binds as one of its actions belongs to the tool, so it never pans while that tool is up.
 */
export class KeyboardPanInput {

    /**
     * @param {Client} client
     * @param {InputDispatcher} inputHandler
     */
    constructor(client, inputHandler) {
        this._client = client;
        this._inputHandler = inputHandler;
        this._tick = () => this._pan();
    }

    /**
     * @returns {void}
     */
    install() {
        this._client.app.ticker.add(this._tick);
    }

    /**
     * @returns {void}
     */
    uninstall() {
        this._client.app.ticker.remove(this._tick);
    }

    /**
     * @private
     * @returns {void}
     */
    _pan() {
        const offset = keyboardPanOffset(
            this._heldKeys(),
            this._client.app.ticker.deltaMS,
            this._client.viewport.scale.x,
        );
        this._client.camera.moveBy(offset.x, offset.y);
    }

    /**
     * The pan keys held right now, minus the ones the active tool claims.
     * @private
     * @returns {Set<string>}
     */
    _heldKeys() {
        const toolKeys = this._toolActionKeys();
        const held = new Set();
        for (const entry of PAN_KEYS) {
            if (Keyboard.isKeyDown(entry.key) && !toolKeys.has(entry.key)) {
                held.add(entry.key);
            }
        }
        return held;
    }

    /**
     * @private
     * @returns {Set<string>}
     */
    _toolActionKeys() {
        const tool = this._inputHandler.activeTool;
        if (tool == null) {
            return new Set();
        }
        return new Set(tool.actions.map(action => action.key));
    }
}

import {PAN_DIRECTIONS, keyboardPanOffset} from "@/client/input/viewportPan.js";

/**
 * Pans the viewport from the held pan keys, one step per rendered frame. A key the active tool
 * binds as one of its actions belongs to the tool, so it never pans while that tool is up.
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
        this._claimedTool = null;
        /** @type {Set<KeybindingEntry>} */
        this._claimedKeybindings = new Set();
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
            this._heldDirections(),
            this._client.app.ticker.deltaMS,
            this._client.viewport.scale.x,
        );
        this._client.camera.moveBy(offset.x, offset.y);
    }

    /**
     * The pan directions held right now, minus the ones the active tool claims.
     * @private
     * @returns {Set<PanDirectionEntry>}
     */
    _heldDirections() {
        const toolKeybindings = this._toolActionKeybindings();
        const held = new Set();
        for (const entry of PAN_DIRECTIONS) {
            if (this._client.keybindings.isKeyDownByEntry(entry.keybinding) && !toolKeybindings.has(entry.keybinding)) {
                held.add(entry);
            }
        }
        return held;
    }

    /**
     * The bindings the active tool claims, rebuilt only when the tool changes: `actions`
     * allocates, and this runs every frame.
     * @private
     * @returns {Set<KeybindingEntry>}
     */
    _toolActionKeybindings() {
        const tool = this._inputHandler.activeTool;
        if (tool !== this._claimedTool) {
            this._claimedTool = tool;
            this._claimedKeybindings = new Set();
            if (tool != null) {
                for (const action of tool.actions) {
                    this._claimedKeybindings.add(action.keybinding);
                }
            }
        }
        return this._claimedKeybindings;
    }
}

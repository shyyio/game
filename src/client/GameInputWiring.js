import {InputHandler} from "@/client/InputHandler.js";

/**
 * Builds the InputHandler and wires its callbacks to the client (mini-menu, inspect, map
 * hover/tap, rotate button).
 * @param {Client} client
 * @returns {InputHandler}
 */
export function createInputHandler(client) {
    const inputHandler = new InputHandler(client.toolbarLayer);
    inputHandler.onMiniMenuEntryClick((tileX, tileY, screenX, screenY, onClose) => {
        const entries = client.miniMenuEntries(tileX, tileY);
        client.miniMenuLayer.open(entries, screenX, screenY, onClose);
    });
    inputHandler.onInspect((tileX, tileY) => {
        client.handleInspect(tileX, tileY);
    });
    inputHandler.onMapHover((tileX, tileY) => {
        client.claimSelection.handleHover(tileX, tileY);
    });
    inputHandler.onMapTap((tileX, tileY) => {
        client.claimSelection.handleSelect(tileX, tileY);
    });
    inputHandler.init();

    client.rotateButtonsLayer.onRotate(() => inputHandler.rotateRight());

    return inputHandler;
}

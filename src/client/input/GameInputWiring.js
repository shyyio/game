import {InputHandler} from "@/client/input/InputHandler.js";

/**
 * Builds the InputHandler and wires its callbacks to the client (object tap, inspect, map
 * hover/tap, rotate button).
 * @param {Client} client
 * @returns {InputHandler}
 */
export function createInputHandler(client) {
    const inputHandler = new InputHandler(client.hud.toolbarLayer);
    inputHandler.onObjectTap((tileX, tileY) => {
        client.onObjectTap(tileX, tileY);
    });
    inputHandler.onObjectHold((tileX, tileY) => {
        client.onObjectHold(tileX, tileY);
    });
    inputHandler.onInspect((tileX, tileY) => {
        client.onInspect(tileX, tileY);
    });
    inputHandler.onMapHover((tileX, tileY) => {
        client.chunkMode.onHover(tileX, tileY);
    });
    inputHandler.onMapTap((tileX, tileY, shiftKey) => {
        client.chunkMode.onSelect(tileX, tileY, shiftKey);
    });
    inputHandler.init();

    client.hud.rotateButtonsLayer.onRotate(() => inputHandler.rotateRight());

    return inputHandler;
}

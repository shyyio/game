import {InputDispatcher} from "@/client/input/InputDispatcher.js";

/**
 * Builds the InputDispatcher and wires its callbacks to the client (object tap, inspect, map
 * hover/tap, rotate button).
 * @param {Client} client
 * @returns {InputDispatcher}
 */
export function createInputHandler(client) {
    const inputHandler = new InputDispatcher(client.hud.toolbarLayer);
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

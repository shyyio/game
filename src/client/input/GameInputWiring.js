import {InputHandler} from "@/client/input/InputHandler.js";

/**
 * Builds the InputHandler and wires its callbacks to the client (object tap, inspect, map
 * hover/tap, rotate button).
 * @param {Client} client
 * @returns {InputHandler}
 */
export function createInputHandler(client) {
    const inputHandler = new InputHandler(client.toolbarLayer);
    inputHandler.onObjectTap((tileX, tileY) => {
        client.handleObjectTap(tileX, tileY);
    });
    inputHandler.onObjectHold((tileX, tileY) => {
        client.handleObjectHold(tileX, tileY);
    });
    inputHandler.onInspect((tileX, tileY) => {
        client.handleInspect(tileX, tileY);
    });
    // The settle flow owns the map while the player holds no chunk; chunk administration after.
    inputHandler.onMapHover((tileX, tileY) => {
        if (client.settleFlow.active) {
            client.settleFlow.handleHover(tileX, tileY);
            return;
        }
        client.claimSelection.handleHover(tileX, tileY);
    });
    inputHandler.onMapTap((tileX, tileY, shiftKey) => {
        if (client.settleFlow.active) {
            client.settleFlow.handleSelect(tileX, tileY, shiftKey);
            return;
        }
        client.claimSelection.handleSelect(tileX, tileY, shiftKey);
    });
    inputHandler.init();

    client.rotateButtonsLayer.onRotate(() => inputHandler.rotateRight());

    return inputHandler;
}

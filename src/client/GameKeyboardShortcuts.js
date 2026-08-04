import Keyboard from "@/client/Keyboard.js";
import {Belts} from "@/mods/Logistics/sim/Belts.js";
import {DEV} from "@/common/env.js";

/**
 * Binds the game's global keyboard shortcuts to the client, toolbar, and sim (local mode only).
 * @param {Client} client
 * @param {Game|null} game
 * @param {ToolbarLayer} toolbar
 * @returns {void}
 */
export function bindGameKeyboardShortcuts(client, game, toolbar) {
    // "c" toggles claim selection; "q" exits any input mode; "h" glides home.
    Keyboard.on("c", () => {
        client.claimSelection.toggle();
    });
    Keyboard.on("q", () => {
        toolbar.setActiveTool(null);
        client.claimSelection.set(false);
    });
    Keyboard.on("h", () => {
        client.glideHome();
    });

    // The local sim also auto-ticks (GameBootstrap.js); "t" forces an extra tick for debugging.
    if (game !== null) {
        // Debug keybindings (moved off the number keys, which now select tools).
        // Insert an item of value 1 onto the lowest-id belt path via its in-port.
        Keyboard.on("b", () => {
            game.simEngine.resolve(Belts).debugInsertItem();
        });

        Keyboard.on("t", () => {
            game.runTick();
        });
    } else if (DEV) {
        // Dev-only: force-closes the socket to test the reconnect flow without touching the server.
        Keyboard.on("k", () => {
            client.session.debugDisconnect();
        });
    }

    // Toggle debug mode
    Keyboard.on("d", () => {
        client.toggleDebugMode();
    });
}

import Keyboard from "@/client/input/Keyboard.js";
import {CONFIRM_HOTKEY, EXIT_HOTKEY} from "@/client/constants.js";
import {Belts} from "@/mods/Logistics/sim/Belts.js";
import {DEV} from "@/common/env.js";

/**
 * Binds the game's global keyboard shortcuts to the client, toolbar, and sim (local mode only).
 * @param {Client} client
 * @param {Game|null} game
 * @param {ToolbarLayer} toolbar
 * @returns {function(): void} unbind
 */
export function bindGameKeyboardShortcuts(client, game, toolbar) {
    const bindings = [];

    function on(key, callback) {
        Keyboard.on(key, callback);
        bindings.push([key, callback]);
    }

    // "c" toggles claim selection; "q" exits any input mode; "h" glides home; "p" toggles production stats.
    on("c", () => {
        client.claimSelection.toggle();
    });
    on(EXIT_HOTKEY, () => {
        toolbar.setActiveTool(null);
        client.claimSelection.set(false);
    });
    // Confirm fires the bottom action bar's forward action (a no-op while the bar is hidden).
    on(CONFIRM_HOTKEY, () => {
        client.bottomActionBar.pressConfirm();
    });
    on("h", () => {
        client.glideHome();
    });
    on("p", () => {
        client.productionPanelLayer.toggle();
    });

    // The local sim also auto-ticks (GameBootstrap.js); "t" forces an extra tick for debugging.
    if (game !== null) {
        // Debug keybindings (moved off the number keys, which now select tools).
        // Insert an item of value 1 onto the lowest-id belt path via its in-port.
        on("b", () => {
            game.simEngine.resolve(Belts).debugInsertItem();
        });

        on("t", () => {
            game.runTick();
        });
    } else if (DEV) {
        // Dev-only: force-closes the socket to test the reconnect flow without touching the server.
        on("k", () => {
            client.session.debugDisconnect();
        });
    }

    // Toggle debug mode
    on("d", () => {
        client.toggleDebugMode();
    });

    return () => {
        for (const [key, callback] of bindings) {
            Keyboard.off(key, callback);
        }
    };
}

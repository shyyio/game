import {
    KEYBINDING_CLAIM,
    KEYBINDING_CONFIRM,
    KEYBINDING_DEBUG,
    KEYBINDING_DISCONNECT,
    KEYBINDING_EXIT,
    KEYBINDING_HOME,
    KEYBINDING_PRODUCTION,
    KEYBINDING_TICK,
} from "@/common/KeybindingEntry.js";
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

    function on(keybinding, callback) {
        client.keybindings.on(keybinding, callback);
        bindings.push([keybinding, callback]);
    }

    on(KEYBINDING_CLAIM, () => {
        client.claimSelection.toggle();
    });
    on(KEYBINDING_EXIT, () => {
        toolbar.setActiveTool(null);
        client.claimSelection.set(false);
    });
    // Confirm fires the bottom action bar's forward action (a no-op while the bar is hidden).
    on(KEYBINDING_CONFIRM, () => {
        client.hud.bottomActionBar.pressConfirm();
    });
    on(KEYBINDING_HOME, () => {
        client.camera.glideHome();
    });
    on(KEYBINDING_PRODUCTION, () => {
        client.hud.productionPanelLayer.toggle();
    });

    // The local sim also auto-ticks (GameBootstrap.js); this forces an extra tick for debugging.
    if (game !== null) {
        on(KEYBINDING_TICK, () => {
            game.runTick();
        });
    } else if (DEV) {
        // Dev-only: force-closes the socket to test the reconnect flow without touching the server.
        on(KEYBINDING_DISCONNECT, () => {
            client.session.debugDisconnect();
        });
    }

    on(KEYBINDING_DEBUG, () => {
        client.settingsMenu.toggleDebugMode();
    });

    return () => {
        for (const [keybinding, callback] of bindings) {
            client.keybindings.off(keybinding, callback);
        }
    };
}

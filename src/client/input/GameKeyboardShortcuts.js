import {
    KEYBINDING_CLAIM,
    KEYBINDING_CONFIRM,
    KEYBINDING_DEBUG,
    KEYBINDING_DETAIL_OVERLAY,
    KEYBINDING_DISCONNECT,
    KEYBINDING_EXIT,
    KEYBINDING_HOME,
    KEYBINDING_PRODUCTION,
    KEYBINDING_TICK,
    KEYBINDING_UNDO,
    KEYBINDING_REDO,
} from "@/common/KeybindingEntry.js";
import {DEV} from "@/common/env.js";
import Mouse from "@/client/input/Mouse.js";
import {TILE_SIZE} from "@/client/constants.js";

/**
 * Floats a reason over the tile the cursor aims at, if any.
 * @param {Client} client
 * @param {string} text
 * @returns {void}
 */
function drawReasonAtAim(client, text) {
    const aim = Mouse.aimPoint();
    if (aim === null) {
        return;
    }
    client.drawPlacementBlockedReason(Math.floor(aim.x / TILE_SIZE), Math.floor(aim.y / TILE_SIZE), text);
}

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
    on(KEYBINDING_UNDO, () => {
        if (!client.undo.undo()) {
            drawReasonAtAim(client, "Nothing to undo");
        }
    });
    on(KEYBINDING_REDO, () => {
        if (!client.undo.redo()) {
            drawReasonAtAim(client, "Nothing to redo");
        }
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

    // Alt by default, which focuses the browser's menu bar unless the keydown is swallowed; a held
    // key repeats, and the overlay flips once per press.
    on(KEYBINDING_DETAIL_OVERLAY, event => {
        event.preventDefault();
        if (event.repeat) {
            return;
        }
        client.settingsMenu.toggleDetailOverlay();
    });

    return () => {
        for (const [keybinding, callback] of bindings) {
            client.keybindings.off(keybinding, callback);
        }
    };
}

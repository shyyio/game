import {ModRegistry} from "@/common/ModRegistry.js";
import {clientLoadout} from "@/mods/clientLoadout.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ClientSaveStore} from "@/client/ClientSaveStore.js";
import {ClientMetricsStore} from "@/client/ClientMetricsStore.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {LocalSession} from "@/sim/LocalSession.js";
import {RemoteSession} from "@/client/RemoteSession.js";
import {WireRegistry} from "@/common/wire.js";
import {Client} from "@/client/Client.js";
import {createInputHandler} from "@/client/GameInputWiring.js";
import {DEV} from "@/common/env.js";
import {mintJoinToken} from "@/client/AuthClient.js";
import WindowFocus from "@/client/WindowFocus.js";
import {DEFAULT_TICK_MS} from "@/common/constants.js";

// Matches the server's --tick-ms default, so local mode runs at the same real-time rate.
const LOCAL_TICK_INTERVAL_MS = DEFAULT_TICK_MS;

/**
 * Builds the mod registry, session (local sim or remote), Client, and its input handler.
 * @param {Application} app
 * @param {ClientViewport} viewport
 * @param {{mode: string, username: string, token: string, serverUrl: string}} props
 * @returns {Promise<{client: Client, session: AbstractSession, game: Game|null, inputHandler: InputHandler, destroy: function(): void}>}
 */
export async function createClient(app, viewport, props) {
    const modRegistry = new ModRegistry();
    for (const pkg of clientLoadout()) {
        modRegistry.register(pkg);
    }
    modRegistry.freeze();

    // Local mode hosts the sim in-process; remote mode has no Game at all — the server owns it.
    let game = null;
    let session;
    if (props.mode === "remote") {
        session = new RemoteSession(
            new WireRegistry(modRegistry), props.serverUrl, props.token,
            () => mintJoinToken(props.serverUrl),
        );
    } else {
        game = new Game(
            modRegistry, new GameEngine(modRegistry), new ClientSaveStore(), new ClientMetricsStore(),
            LOCAL_TICK_INTERVAL_MS,
        );
        await game.init();

        // Dev scenarios populate the world before any session connects, so the objects reach the
        // client through the normal chunk sync. DEV is a build-time literal, so the whole scenario
        // tree drops out of production bundles.
        if (DEV) {
            const {applyScenarioFromLocation} = await import("@/test/scenarios/index.js");
            await applyScenarioFromLocation(game);
        }

        session = new LocalSession(new GameAPI(game));
    }

    const client = new Client(app, viewport, session, modRegistry);
    session.client = client;

    let unsubWindowFocus = null;
    let onOnline = null;
    let tickInterval = null;
    if (game === null) {
        session.onStatusChange(status => client.onConnectionStatusChange(status));
        session.connect();
        // A tab regaining focus or the network coming back online means the current backoff
        // wait is likely stale; retry immediately instead of waiting it out.
        unsubWindowFocus = WindowFocus.onChange(focused => {
            if (focused) {
                session.retryNow();
            }
        });
        onOnline = () => session.retryNow();
        window.addEventListener("online", onOnline);
    } else {
        game.connect(session);
        // runTick() flushes/pushes metrics itself, piggybacking on this interval.
        tickInterval = window.setInterval(() => game.runTick(), LOCAL_TICK_INTERVAL_MS);
    }
    await client.init();

    const inputHandler = createInputHandler(client);

    const renderToolbar = () => client.toolbarLayer.setTools(client.coreTools(), client.modTools());
    renderToolbar();
    // Re-renders the toolbar once the player's custom order syncs (or after a local reorder);
    // wired only after the toolbar's first render, so an in-flight sync racing client.init()
    // never rebuilds it before its textureRegistry is set.
    client.cache.subscribe("playerSettings.toolOrder", renderToolbar);

    /**
     * Reverses everything above that outlives a Client/viewport teardown: the reconnect loop,
     * its window listeners, and the local sim's tick interval.
     * @returns {void}
     */
    function destroy() {
        session.disconnect();
        if (unsubWindowFocus !== null) {
            unsubWindowFocus();
        }
        if (onOnline !== null) {
            window.removeEventListener("online", onOnline);
        }
        if (tickInterval !== null) {
            window.clearInterval(tickInterval);
        }
    }

    return {client, session, game, inputHandler, destroy};
}

import {ModRegistry} from "@/common/ModRegistry.js";
import {clientLoadout} from "@/mods/clientLoadout.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ClientSaveStore} from "@/client/ClientSaveStore.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {LocalSession} from "@/sim/LocalSession.js";
import {RemoteSession} from "@/client/RemoteSession.js";
import {WireRegistry} from "@/common/wire.js";
import {Client} from "@/client/Client.js";
import {createInputHandler} from "@/client/GameInputWiring.js";
import {DEV} from "@/common/env.js";

/**
 * Builds the mod registry, session (local sim or remote), Client, and its input handler.
 * @param {Application} app
 * @param {ClientViewport} viewport
 * @param {{mode: string, username: string, serverUrl: string}} props
 * @returns {Promise<{client: Client, session: AbstractSession, game: Game|null, inputHandler: InputHandler}>}
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
        session = new RemoteSession(new WireRegistry(modRegistry), props.serverUrl, props.username);
    } else {
        game = new Game(modRegistry, new GameEngine(modRegistry), new ClientSaveStore());
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
    if (game === null) {
        session.onClose(code => client.notify(`Disconnected from server (${code})`));
        session.connect();
    } else {
        game.connect(session);
    }
    await client.init();

    const inputHandler = createInputHandler(client);

    const toolbar = client.toolbarLayer;
    const refreshTools = () => {
        toolbar.setTools(client.coreTools(), client.modTools());
    };
    client.cache.subscribe("playerSettings.values", refreshTools);
    refreshTools();

    return {client, session, game, inputHandler};
}

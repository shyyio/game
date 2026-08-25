import {ModRegistry} from "@/common/ModRegistry.js";
import {fetchModLoadout} from "@/client/ModFetcher.js";
import {fetchSideloadedMods, sideloadedModUrls} from "@/client/ModSideload.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {randomWorldSeed} from "@/common/WorldNoise.js";
import {ClientSaveStore} from "@/client/state/ClientSaveStore.js";
import {ClientMetricsStore} from "@/client/state/ClientMetricsStore.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {LocalSession} from "@/sim/LocalSession.js";
import {RemoteSession} from "@/client/RemoteSession.js";
import {WireRegistry} from "@/common/wire.js";
import {Client} from "@/client/Client.js";
import {createInputHandler} from "@/client/input/GameInputWiring.js";
import {DITHER_PATTERNS, setActiveDither, setDitherEnabled, ditherOn, setDitherScale, ditherScale} from "@/client/layers/DitherPatterns.js";
import {setBlendLevels, blendLevelCount} from "@/client/layers/TerrainSprite.js";
import {mintReconnectToken, enterServerContext} from "@/client/AuthClient.js";
import WindowFocus from "@/client/WindowFocus.js";
import {DEFAULT_TICK_MS} from "@/common/constants.js";
import {GAME_MODE_REMOTE} from "@/client/GameStart.js";
import {SCENARIO_PARAM} from "@/test/scenarios/scenarioParam.js";

// Matches the server's --tick-ms default, so local mode runs at the same real-time rate.
const LOCAL_TICK_INTERVAL_MS = DEFAULT_TICK_MS;

/**
 * The packages to register. A remote server's own pinned loadout is fetched from it — the client
 * ships no game content for remote play, which is also what keeps the positional wire ids in sync.
 * Local mode has no server to ask, so it registers the loadout built into this client, imported
 * lazily so a remote join never loads it, then the side-loaded packages a `?mod=` URL asks for, then
 * whatever mod the selected `?scenario=` brings of its own. Both extras append, leaving the built-in
 * packages' positional ids untouched.
 * @param {{mode: string, serverUrl: string}} props
 * @param {string[]} sideloadUrls package base URLs, empty in remote mode
 * @returns {Promise<ModPackage[]>}
 */
async function loadoutFor(props, sideloadUrls) {
    if (props.mode === GAME_MODE_REMOTE) {
        return await fetchModLoadout(props.serverUrl);
    }
    const {clientLoadout} = await import("@/mods/clientLoadout.js");
    const packages = [...clientLoadout(), ...await fetchSideloadedMods(sideloadUrls)];
    if (scenarioSelected()) {
        const {scenarioModPackages} = await import("@/test/scenarios/index.js");
        packages.push(...scenarioModPackages());
    }
    return packages;
}

/**
 * @returns {boolean}
 */
function scenarioSelected() {
    return new URLSearchParams(window.location.search).has(SCENARIO_PARAM);
}

/**
 * Builds the mod registry, session (local sim or remote), Client, and its input handler.
 * @param {Application} app
 * @param {ClientViewport} viewport
 * @param {{mode: string, username: string, token: string, serverUrl: string}} props
 * @returns {Promise<{client: Client, session: AbstractSession, game: Game|null, inputHandler: InputHandler, destroy: function(): void}>}
 */
export async function createClient(app, viewport, props) {
    if (props.mode === GAME_MODE_REMOTE) {
        // The server's mod code is about to be evaluated in this page; the account session must be
        // gone before it runs, leaving only this server's origin-scoped reconnect token.
        enterServerContext();
    }

    // A server's loadout is exactly what it pins, so only local play side-loads.
    let sideloadUrls = [];
    if (props.mode !== GAME_MODE_REMOTE) {
        sideloadUrls = sideloadedModUrls();
    }

    const modRegistry = new ModRegistry();
    for (const pkg of await loadoutFor(props, sideloadUrls)) {
        modRegistry.register(pkg);
    }
    modRegistry.freeze();

    // Local mode hosts the sim in-process; remote mode has no Game at all — the server owns it.
    let game = null;
    let session;
    if (props.mode === GAME_MODE_REMOTE) {
        session = new RemoteSession(
            new WireRegistry(modRegistry), props.serverUrl, props.token,
            () => mintReconnectToken(props.serverUrl),
        );
    } else {
        game = new Game(
            modRegistry, new GameEngine(modRegistry), new ClientSaveStore(), new ClientMetricsStore(),
            LOCAL_TICK_INTERVAL_MS, randomWorldSeed(),
        );
        await game.init();

        // Scenarios populate the world before any session connects, so the objects reach the client
        // through the normal chunk sync. Only a ?scenario= URL pulls in the tree.
        if (scenarioSelected()) {
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

    // Console helper for bug reports: copy(dumpGameState()) puts a paste-able world snapshot
    // (the save format plus a debug block) on the clipboard.
    window.dumpGameState = () => {
        if (game === null) {
            throw new Error("dumpGameState: remote session, the sim state lives on the server");
        }
        const snapshot = game.serialize();
        snapshot.debug = {
            url: window.location.href,
            capturedAt: new Date().toISOString(),
            viewport: {x: viewport.center.x, y: viewport.center.y, scale: viewport.scale.x},
        };
        return JSON.stringify(snapshot);
    };

    // Console helper for comparing the ground's dither: setTerrainDither("r2") repaints in place.
    window.setTerrainDither = name => {
        const pattern = setActiveDither(name);
        client.terrainLayer.repaint();
        return pattern.name;
    };
    window.terrainDithers = () => DITHER_PATTERNS.map(pattern => pattern.name);
    // setTerrainBlending(n) bands a biome edge into n mixed steps; at 0 nothing mixes, so the edge
    // stipples the two flat colors instead. setTerrainDithering(false) drops the stipple, leaving
    // flat bands or a hard step.
    window.setTerrainBlending = levels => {
        setBlendLevels(levels);
        client.terrainLayer.repaint();
        return blendLevelCount();
    };
    window.setTerrainDithering = enabled => {
        setDitherEnabled(enabled);
        client.terrainLayer.repaint();
        return ditherOn();
    };
    // Only the "noise" pattern reads this: bigger scale = finer grain, smaller = broader patches.
    window.setTerrainDitherScale = scale => {
        setDitherScale(scale);
        client.terrainLayer.repaint();
        return ditherScale();
    };

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
        delete window.dumpGameState;
        delete window.setTerrainDither;
        delete window.terrainDithers;
        delete window.setTerrainBlending;
        delete window.setTerrainDithering;
        delete window.setTerrainDitherScale;
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

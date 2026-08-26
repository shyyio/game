import {parseArgs} from "node:util";
import {ModRegistry} from "@/common/ModRegistry.js";
import {simLoadout} from "@/mods/loadout.js";
import {Game} from "@/sim/Game.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {NodeMetricsStore} from "@/server/NodeMetricsStore.js";
import {JwksVerifier} from "@/server/JwksVerifier.js";
import {GameServer} from "@/server/GameServer.js";
import {readLockfile} from "@/server/modLockfileFile.js";
import {ModCache} from "@/server/ModCache.js";
import {ModHost} from "@/server/ModHost.js";
import {loadPackagedMods} from "@/server/ModLoader.js";
import {bindShutdownSignals} from "@/server/cliShutdown.js";
import {installCrashReporter, reportError, reportFatal} from "@/server/crashReporter.js";
import {DEFAULT_TICK_MS} from "@/common/constants.js";
import {randomWorldSeed} from "@/common/WorldNoise.js";

const {values: args} = parseArgs({
    options: {
        "db": {type: "string", default: "world.sqlite3"},
        "metrics-db": {type: "string", default: "metrics.sqlite3"},
        "host": {type: "string", default: "0.0.0.0"},
        "port": {type: "string", default: "27500"},
        "tick-ms": {type: "string", default: String(DEFAULT_TICK_MS)},
        "save-ms": {type: "string", default: "60000"},
        "seed": {type: "string"},
        "auth-server": {type: "string", default: "https://auth.spupgame.com"},
        "origin": {type: "string", default: "ws://localhost:27500"},
        "name": {type: "string", default: "Shy's Power-Up Factory"},
        "mods": {type: "string"},
        "mods-cache": {type: "string", default: "mods-cache"},
    },
});
const dbPath = args["db"];
const metricsDbPath = args["metrics-db"];
const host = args["host"];
const port = Number(args["port"]);
const tickMs = Number(args["tick-ms"]);
const saveMs = Number(args["save-ms"]);
// Absent: a fresh world draws a random seed, a loaded one keeps its own.
const seedArg = args["seed"] === undefined ? null : Number(args["seed"]);
const authServerUrl = args["auth-server"];
const origin = args["origin"];
const name = args["name"];
const modsPath = args["mods"];
const modsCachePath = args["mods-cache"];

installCrashReporter(origin);

// Without --mods the server runs the loadout compiled into this build; with it, the loadout is
// whatever the operator pinned, fetched into the local cache and served to clients from here.
let modHost = null;
let packages;
if (modsPath === undefined) {
    packages = simLoadout();
} else {
    const lockfile = readLockfile(modsPath);
    const cache = new ModCache(modsCachePath);
    const downloaded = await cache.populate(lockfile);
    const loaded = await loadPackagedMods(lockfile, cache);
    packages = loaded.packages;
    modHost = new ModHost(loaded.mods, cache);
    console.log(`Loaded ${packages.length} pinned mods from ${modsPath} (${downloaded} newly downloaded)`);
}

const modRegistry = new ModRegistry();
for (const pkg of packages) {
    modRegistry.register(pkg);
}
modRegistry.freeze();

const game = new Game(
    modRegistry, new GameEngine(modRegistry), new NodeSaveStore(dbPath), new NodeMetricsStore(metricsDbPath), tickMs,
    seedArg === null ? randomWorldSeed() : seedArg,
);
await game.init();
try {
    if (await game.load()) {
        console.log(`Loaded world from ${dbPath} (seed ${game.seed})`);
    } else {
        console.log(`Fresh world; saving to ${dbPath} (seed ${game.seed})`);
    }
} catch (error) {
    await reportFatal(error, `Refusing to start: ${dbPath} is incompatible with the current build`);
}
if (seedArg !== null && game.seed !== seedArg) {
    await reportFatal(
        new Error(`--seed ${seedArg} does not match the saved world seed ${game.seed}`),
        `Refusing to start: ${dbPath} was generated with a different seed`,
    );
}

const jwksVerifier = new JwksVerifier(authServerUrl);
await jwksVerifier.load();

const api = new GameAPI(game);
const server = new GameServer(game, api, jwksVerifier, origin, name, modHost);
await server.listen(host, port);
console.log(`Listening on ws://${host}:${port} (tick ${tickMs}ms, save ${saveMs}ms, metrics every tick)`);

const tickInterval = setInterval(() => {
    try {
        game.runTick();
    } catch (error) {
        // Stop ticking first: reportFatal awaits the POST, and a broken sim would throw again
        // on every interval in the meantime.
        clearInterval(tickInterval);
        reportFatal(error, "Tick failed");
    }
}, tickMs);

const saveInterval = setInterval(() => {
    game.save().catch(error => {
        reportError(error, "Save failed");
    });
}, saveMs);

bindShutdownSignals(async signal => {
    console.log(`${signal}: saving and shutting down`);
    clearInterval(tickInterval);
    clearInterval(saveInterval);
    server.shutdown();
    await Promise.all([game.save(), game.metrics.flush()]);
    await game.metrics.close();
});

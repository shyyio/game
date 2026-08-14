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
import {bindShutdownSignals} from "@/server/cliShutdown.js";
import {installCrashReporter, reportError, reportFatal} from "@/server/crashReporter.js";
import {DEFAULT_TICK_MS} from "@/common/constants.js";

const {values: args} = parseArgs({
    options: {
        "db": {type: "string", default: "world.sqlite3"},
        "metrics-db": {type: "string", default: "metrics.sqlite3"},
        "host": {type: "string", default: "0.0.0.0"},
        "port": {type: "string", default: "27500"},
        "tick-ms": {type: "string", default: String(DEFAULT_TICK_MS)},
        "save-ms": {type: "string", default: "60000"},
        "auth-server": {type: "string", default: "https://auth.spupgame.com"},
        "origin": {type: "string", default: "ws://localhost:27500"},
        "name": {type: "string", default: "Shy's Power-Up Factory"},
    },
});
const dbPath = args["db"];
const metricsDbPath = args["metrics-db"];
const host = args["host"];
const port = Number(args["port"]);
const tickMs = Number(args["tick-ms"]);
const saveMs = Number(args["save-ms"]);
const authServerUrl = args["auth-server"];
const origin = args["origin"];
const name = args["name"];

installCrashReporter(origin);

const modRegistry = new ModRegistry();
for (const pkg of simLoadout()) {
    modRegistry.register(pkg);
}
modRegistry.freeze();

const game = new Game(
    modRegistry, new GameEngine(modRegistry), new NodeSaveStore(dbPath), new NodeMetricsStore(metricsDbPath), tickMs,
);
await game.init();
try {
    if (await game.load()) {
        console.log(`Loaded world from ${dbPath}`);
    } else {
        console.log(`Fresh world; saving to ${dbPath}`);
    }
} catch (error) {
    await reportFatal(error, `Refusing to start: ${dbPath} is incompatible with the current build`);
}

const jwksVerifier = new JwksVerifier(authServerUrl);
await jwksVerifier.load();

const api = new GameAPI(game);
const server = new GameServer(game, api, jwksVerifier, origin, name);
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

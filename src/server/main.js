import {parseArgs} from "node:util";
import {ModRegistry} from "@/common/ModRegistry.js";
import {simLoadout} from "@/mods/loadout.js";
import {Game} from "@/sim/Game.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {JwksVerifier} from "@/server/JwksVerifier.js";
import {GameServer} from "@/server/GameServer.js";

const {values: args} = parseArgs({
    options: {
        "db": {type: "string", default: "world.sqlite3"},
        "host": {type: "string", default: "0.0.0.0"},
        "port": {type: "string", default: "8080"},
        "tick-ms": {type: "string", default: "600"},
        "save-ms": {type: "string", default: "60000"},
        "auth-server": {type: "string", default: "http://localhost:8081"},
        "origin": {type: "string", default: "ws://localhost:8080"},
        "name": {type: "string", default: "Shy's Power-Up Factory"},
    },
});
const dbPath = args["db"];
const host = args["host"];
const port = Number(args["port"]);
const tickMs = Number(args["tick-ms"]);
const saveMs = Number(args["save-ms"]);
const authServerUrl = args["auth-server"];
const origin = args["origin"];
const name = args["name"];

const modRegistry = new ModRegistry();
for (const pkg of simLoadout()) {
    modRegistry.register(pkg);
}
modRegistry.freeze();

const game = new Game(modRegistry, new GameEngine(modRegistry), new NodeSaveStore(dbPath));
await game.init();
try {
    if (await game.load()) {
        console.log(`Loaded world from ${dbPath}`);
    } else {
        console.log(`Fresh world; saving to ${dbPath}`);
    }
} catch (error) {
    console.error(`Refusing to start: ${dbPath} is incompatible with the current build.\n${error.message}`);
    process.exit(1);
}

const jwksVerifier = new JwksVerifier(authServerUrl);
await jwksVerifier.load();

const api = new GameAPI(game);
const server = new GameServer(game, api, jwksVerifier, origin, name);
await server.listen(host, port);
console.log(`Listening on ws://${host}:${port} (tick ${tickMs}ms, save ${saveMs}ms)`);

const tickInterval = setInterval(() => {
    game.runTick();
}, tickMs);

const saveInterval = setInterval(() => {
    game.save().catch(error => {
        console.error("Save failed:", error);
    });
}, saveMs);

let shuttingDown = false;

/**
 * @param {string} signal
 * @returns {Promise<void>}
 */
async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    console.log(`${signal}: saving and shutting down`);
    clearInterval(tickInterval);
    clearInterval(saveInterval);
    server.stop();
    await game.save();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

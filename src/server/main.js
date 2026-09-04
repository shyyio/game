import {dirname, resolve} from "node:path";
import {parseArgs} from "node:util";
import {JwksVerifier} from "@/server/JwksVerifier.js";
import {GameServer} from "@/server/GameServer.js";
import {AdminRoutes} from "@/server/AdminRoutes.js";
import {ServerRuntime} from "@/server/ServerRuntime.js";
import {World} from "@/server/World.js";
import {
    generateAdminToken, readServerConfigOrDefault, resolveConfigPaths, writeServerConfig,
} from "@/server/serverConfigFile.js";
import {ServerConfig} from "@/common/ServerConfig.js";
import {pinBuiltMods} from "@/server/builtMods.js";
import {bindShutdownSignals} from "@/nodeservice/cliShutdown.js";
import {installCrashReporter, reportError, reportFatal} from "@/server/crashReporter.js";

// Every setting lives in the config file; a flag given here overrides that one field for this run.
const {values: args} = parseArgs({
    options: {
        "config": {type: "string", default: "server.json"},
        "admin-dir": {type: "string", default: "build/admin"},
        "dist-mods": {type: "string", default: "build/mods"},
        "db": {type: "string"},
        "metrics-db": {type: "string"},
        "host": {type: "string"},
        "port": {type: "string"},
        "tick-ms": {type: "string"},
        "save-ms": {type: "string"},
        "seed": {type: "string"},
        "auth-server": {type: "string"},
        "origin": {type: "string"},
        "name": {type: "string"},
        "mods-cache": {type: "string"},
    },
});

/**
 * @param {string} flag
 * @returns {number|undefined}
 */
function numberFlag(flag) {
    if (args[flag] === undefined) {
        return undefined;
    }
    return Number(args[flag]);
}

/**
 * A path given on the command line counts from the working directory, as a shell user expects.
 * @param {string} flag
 * @returns {string|undefined}
 */
function pathFlag(flag) {
    if (args[flag] === undefined) {
        return undefined;
    }
    return resolve(args[flag]);
}

const configPath = args["config"];
let saved = readServerConfigOrDefault(configPath);
// The first boot mints the admin page's token and keeps it in the file.
const mintedAdminToken = saved.adminToken === null;
if (mintedAdminToken) {
    const json = saved.toJSON();
    json.adminToken = generateAdminToken();
    saved = ServerConfig.parse(json);
    writeServerConfig(saved, configPath);
}
// A relative path in the file counts from the file's own directory, so a data directory moves as one.
const baseDir = dirname(resolve(configPath));
const {config, pinned} = saved.withOverrides({
    db: pathFlag("db"),
    metricsDb: pathFlag("metrics-db"),
    host: args["host"],
    port: numberFlag("port"),
    tickMs: numberFlag("tick-ms"),
    saveMs: numberFlag("save-ms"),
    seed: numberFlag("seed"),
    authServer: args["auth-server"],
    origin: args["origin"],
    name: args["name"],
    modsCache: pathFlag("mods-cache"),
});
const adminDir = args["admin-dir"];
const distMods = args["dist-mods"];

installCrashReporter(config.origin);

let world;
try {
    world = await World.boot(resolveConfigPaths(config, baseDir));
} catch (error) {
    await reportFatal(error, `Refusing to start: ${error.message}`);
}

const jwksVerifier = new JwksVerifier(config.authServer);
await jwksVerifier.load();

const server = new GameServer(jwksVerifier, config.origin, config.name);
server.setWorld(world);
const runtime = new ServerRuntime({
    world,
    gameServer: server,
    config,
    baseDir,
    pinned,
    onTickError: error => {
        reportFatal(error, "Tick failed");
    },
    onSaveError: error => {
        reportError(error, "Save failed");
    },
});
const builtMods = await pinBuiltMods(distMods);
if (builtMods === null) {
    console.warn(`No built mods at ${distMods}: the admin page cannot pin the built-in mods (build them with \`npm run mods:base\`, or pass --dist-mods)`);
}
new AdminRoutes({
    configPath,
    saved,
    pinned,
    runtime,
    adminDir,
    builtMods,
    distMods,
}).registerRoutes(server.app);
await server.listen(config.host, config.port);
runtime.start();
console.log(`Listening on ws://${config.host}:${config.port} (tick ${config.tickMs}ms, save ${config.saveMs}ms, metrics every tick)`);
// Printed once, when it is minted: every later boot would put it in the log for good.
if (mintedAdminToken) {
    console.log(`Admin page at /admin on that port; token ${config.adminToken}`);
} else {
    console.log(`Admin page at /admin on that port; token in ${configPath}`);
}

bindShutdownSignals(async signal => {
    console.log(`${signal}: saving and shutting down`);
    runtime.stop();
    server.shutdown();
    await runtime.world.close();
});

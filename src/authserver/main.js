import {parseArgs} from "node:util";
import {NodeAccountStore} from "@/authserver/NodeAccountStore.js";
import {AccountRegistry} from "@/authserver/AccountRegistry.js";
import {SigningKeys} from "@/authserver/SigningKeys.js";
import {loadOrCreateAuthSecret} from "@/authserver/AuthSecret.js";
import {JoinTokenService} from "@/authserver/JoinTokenService.js";
import {AuthHttpServer} from "@/authserver/AuthHttpServer.js";
import {ServerDirectory} from "@/authserver/ServerDirectory.js";

const {values: args} = parseArgs({
    options: {
        "db": {type: "string", default: "auth.sqlite3"},
        "signing-key": {type: "string", default: "auth-signing-key.json"},
        "auth-secret": {type: "string", default: "auth-secret.json"},
        "servers": {type: "string", default: "servers.json"},
        "host": {type: "string", default: "0.0.0.0"},
        "port": {type: "string", default: "8081"},
    },
});
const dbPath = args["db"];
const signingKeyPath = args["signing-key"];
const authSecretPath = args["auth-secret"];
const serversPath = args["servers"];
const host = args["host"];
const port = Number(args["port"]);

const store = new NodeAccountStore(dbPath);
const accounts = new AccountRegistry(store);
const signingKeys = new SigningKeys(signingKeyPath);
const joinTokens = new JoinTokenService(signingKeys, loadOrCreateAuthSecret(authSecretPath));
const servers = new ServerDirectory(serversPath);
const server = new AuthHttpServer(accounts, signingKeys, joinTokens, servers);
await server.listen(host, port);
console.log(`Auth server listening on http://${host}:${port} (db ${dbPath})`);

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
    console.log(`${signal}: shutting down`);
    server.stop();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

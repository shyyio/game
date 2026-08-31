import {parseArgs} from "node:util";
import {NodeErrorReportStore} from "@/reportingserver/NodeErrorReportStore.js";
import {Symbolicator} from "@/reportingserver/Symbolicator.js";
import {ReportingHttpServer} from "@/reportingserver/ReportingHttpServer.js";
import {bindShutdownSignals} from "@/nodeservice/cliShutdown.js";

const {values: args} = parseArgs({
    options: {
        "db": {type: "string", default: "reporting.sqlite3"},
        "maps-dir": {type: "string", default: "dist/maps"},
        "host": {type: "string", default: "0.0.0.0"},
        "port": {type: "string", default: "27502"},
    },
});
const dbPath = args["db"];
const mapsDir = args["maps-dir"];
const host = args["host"];
const port = Number(args["port"]);

const store = new NodeErrorReportStore(dbPath);
const symbolicator = new Symbolicator(mapsDir);
const server = new ReportingHttpServer(store, symbolicator);
await server.listen(host, port);
console.log(`Reporting server listening on http://${host}:${port} (db ${dbPath}, maps ${mapsDir})`);

bindShutdownSignals(signal => {
    console.log(`${signal}: shutting down`);
    server.stop();
});

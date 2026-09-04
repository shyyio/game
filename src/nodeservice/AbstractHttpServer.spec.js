import {test} from "node:test";
import assert from "node:assert/strict";
import {AbstractHttpServer, guarded, readJson, respondJson} from "@/nodeservice/AbstractHttpServer.js";

/**
 * A server whose routes throw, standing in for any handler that hits an unexpected error.
 */
class ThrowingServer extends AbstractHttpServer {

    constructor() {
        super();
        this._app.get("/throws", guarded(() => {
            throw new Error("handler blew up");
        }));
        this._app.post("/throws-on-json", guarded(res => {
            readJson(res, () => {
                throw new Error("json handler blew up");
            });
        }));
        this._app.get("/fine", guarded(res => {
            respondJson(res, {ok: true});
        }));
    }
}

/**
 * @returns {Promise<{server: ThrowingServer, baseUrl: string}>}
 */
async function startServer() {
    const server = new ThrowingServer();
    await server.listen("127.0.0.1", 0);
    return {server, baseUrl: `http://127.0.0.1:${server.port}`};
}

test("a throwing route handler answers 500 and leaves the process serving", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/throws`);
        assert.equal(response.status, 500);

        const after = await fetch(`${baseUrl}/fine`);
        assert.equal(after.status, 200);
        assert.deepEqual(await after.json(), {ok: true});
    } finally {
        server.stop();
    }
});

test("a throwing JSON handler answers 500 and leaves the process serving", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/throws-on-json`, {method: "POST", body: "{}"});
        assert.equal(response.status, 500);

        const after = await fetch(`${baseUrl}/fine`);
        assert.equal(after.status, 200);
    } finally {
        server.stop();
    }
});

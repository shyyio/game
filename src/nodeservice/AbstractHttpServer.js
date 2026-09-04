import uWS from "uWebSockets.js";

/**
 * Shared uWebSockets.js plumbing for this project's HTTP front ends (game, auth, reporting):
 * listen/stop lifecycle. The JSON respond/reject/readBody helpers every route handler uses are the
 * free functions beside it. Subclasses build their own uWS.App() (via the `app` getter) and
 * register routes in their constructor.
 */
export class AbstractHttpServer {

    constructor() {
        this._app = uWS.App();
        this._listenSocket = null;
    }

    /**
     * @returns {object} the uWS.App instance, for subclasses to register routes on
     */
    get app() {
        return this._app;
    }

    /**
     * @param {string} host
     * @param {number} port
     * @returns {Promise<void>} resolves once the port is bound; rejects when taken
     */
    listen(host, port) {
        return new Promise((resolve, reject) => {
            this._app.listen(host, port, listenSocket => {
                if (!listenSocket) {
                    reject(new Error(`Failed to listen on ${host}:${port}`));
                    return;
                }
                this._listenSocket = listenSocket;
                resolve();
            });
        });
    }

    /**
     * The bound port, useful when listen() was called with port 0.
     * @returns {number}
     */
    get port() {
        return uWS.us_socket_local_port(this._listenSocket);
    }

    /**
     * @returns {void}
     */
    stop() {
        if (this._listenSocket !== null) {
            uWS.us_listen_socket_close(this._listenSocket);
            this._listenSocket = null;
        }
    }

    /**
     * The shared plain-text welcome/info-screen banner every HTTP front end serves to browsers.
     * @protected
     * @param {string} title - e.g. "Auth Server"
     * @param {Array<string>} fields - "  label : value" lines shown below the banner
     * @returns {string}
     */
    _infoScreenBanner(title, fields) {
        const width = 46;
        const padTotal = width - title.length;
        const padLeft = Math.floor(padTotal / 2);
        const padRight = padTotal - padLeft;
        return [
            "+==============================================+",
            "|            SHY'S POWER-UP FACTORY            |",
            `|${" ".repeat(padLeft)}${title}${" ".repeat(padRight)}|`,
            "+==============================================+",
            "",
            ...fields,
        ].join("\n");
    }
}

/**
 * @param {object} res
 * @param {object} body
 * @returns {void}
 */
export function respondJson(res, body) {
    res.cork(() => {
        res.writeHeader("Content-Type", "application/json")
            .writeHeader("Access-Control-Allow-Origin", "*")
            .end(JSON.stringify(body));
    });
}

/**
 * @param {object} res
 * @param {string} status - e.g. "400 Bad Request"
 * @param {string} message
 * @param {{cors: boolean}} [options]
 * @returns {void}
 */
export function rejectRequest(res, status, message, {cors = false} = {}) {
    res.cork(() => {
        res.writeStatus(status).writeHeader("Content-Type", "text/plain; charset=utf-8");
        if (cors) {
            res.writeHeader("Access-Control-Allow-Origin", "*");
        }
        res.end(message);
    });
}

/**
 * Wraps a route handler so a throw answers 500. uWS terminates the process when a handler returns
 * without responding, which a throw does, so this has to sit inside the handler: a process-level
 * uncaughtException hook runs too late to stop it.
 * @param {(res: object, req: object) => void} handler
 * @returns {(res: object, req: object) => void}
 */
export function guarded(handler) {
    return (res, req) => {
        try {
            handler(res, req);
        } catch (error) {
            console.error("Request handler threw:", error);
            rejectRequest(res, "500 Internal Server Error", "Internal error", {cors: true});
        }
    };
}

/**
 * Buffers a request body, parses it as JSON, and hands the value to onJson; a body that is not
 * JSON is rejected here and onJson never runs. A throw out of onJson answers 500.
 * @param {object} res
 * @param {(payload: *) => void} onJson
 * @returns {void}
 */
export function readJson(res, onJson) {
    res.onAborted(() => {
        res.aborted = true;
    });
    readBody(res, body => {
        if (res.aborted) {
            return;
        }
        let payload;
        try {
            payload = JSON.parse(body);
        } catch (error) {
            rejectRequest(res, "400 Bad Request", "Malformed JSON body", {cors: true});
            return;
        }
        try {
            onJson(payload);
        } catch (error) {
            console.error("Request handler threw:", error);
            rejectRequest(res, "500 Internal Server Error", "Internal error", {cors: true});
        }
    });
}

/**
 * Buffers a request body and hands the full UTF-8 text to onEnd.
 * @param {object} res
 * @param {(body: string) => void} onEnd
 * @returns {void}
 */
export function readBody(res, onEnd) {
    let buffer;
    res.onData((chunk, isLast) => {
        // Buffer.from(arrayBuffer) is a view, not a copy; uWS detaches chunk right after
        // this callback returns, so copy it now via slice() before buffering it past that point.
        const piece = Buffer.from(chunk.slice(0));
        if (buffer === undefined) {
            buffer = piece;
        } else {
            buffer = Buffer.concat([buffer, piece]);
        }
        if (isLast) {
            if (buffer === undefined) {
                onEnd("");
            } else {
                onEnd(buffer.toString("utf8"));
            }
        }
    });
}

import uWS from "uWebSockets.js";

/**
 * Shared uWebSockets.js plumbing for this project's HTTP backend services (auth, reporting):
 * listen/stop lifecycle plus the JSON respond/reject/readBody helpers every route handler uses.
 * Subclasses build their own uWS.App() (via the `app` getter) and register routes in their
 * constructor.
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

    /**
     * @protected
     * @param {object} res
     * @param {object} body
     * @returns {void}
     */
    _respond(res, body) {
        res.cork(() => {
            res.writeHeader("Content-Type", "application/json")
                .writeHeader("Access-Control-Allow-Origin", "*")
                .end(JSON.stringify(body));
        });
    }

    /**
     * @protected
     * @param {object} res
     * @param {string} status - e.g. "400 Bad Request"
     * @param {string} message
     * @param {{cors: boolean}} [options]
     * @returns {void}
     */
    _reject(res, status, message, {cors = false} = {}) {
        res.cork(() => {
            res.writeStatus(status).writeHeader("Content-Type", "text/plain; charset=utf-8");
            if (cors) {
                res.writeHeader("Access-Control-Allow-Origin", "*");
            }
            res.end(message);
        });
    }

    /**
     * Buffers a request body and hands the full UTF-8 text to onEnd.
     * @protected
     * @param {object} res
     * @param {(body: string) => void} onEnd
     * @returns {void}
     */
    _readBody(res, onEnd) {
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
}

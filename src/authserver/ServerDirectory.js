import {existsSync, readFileSync} from "node:fs";

/**
 * The manually-edited server list the client picks a game server from; read fresh on every
 * call so an operator can edit the file without restarting the auth server.
 */
export class ServerDirectory {

    /**
     * @param {string} path - JSON file holding an array of {origin} entries
     */
    constructor(path) {
        this._path = path;
    }

    /**
     * @returns {{origin: string}[]}
     */
    list() {
        if (!existsSync(this._path)) {
            return [];
        }
        return JSON.parse(readFileSync(this._path, "utf8"));
    }
}

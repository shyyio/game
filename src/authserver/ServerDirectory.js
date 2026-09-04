import {existsSync, readFileSync} from "node:fs";

/**
 * The manually-edited server list the client picks a game server from; read fresh on every
 * call so an operator can edit the file without restarting the auth server. A file that is
 * missing or unreadable serves the last good list, so a typo in it can't take the service down.
 */
export class ServerDirectory {

    /**
     * @param {string} path - JSON file holding an array of {origin} entries
     */
    constructor(path) {
        this._path = path;
        this._lastGood = [];
    }

    /**
     * @returns {{origin: string}[]}
     */
    list() {
        if (!existsSync(this._path)) {
            return this._lastGood;
        }
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(this._path, "utf8"));
        } catch (error) {
            console.error(`Server list ${this._path} is unreadable, serving the last good one: ${error.message}`);
            return this._lastGood;
        }
        if (!Array.isArray(parsed)) {
            console.error(`Server list ${this._path} is not an array, serving the last good one`);
            return this._lastGood;
        }
        this._lastGood = parsed;
        return parsed;
    }
}

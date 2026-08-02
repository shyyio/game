import {randomBytes} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";

const AUTH_SECRET_BYTES = 32;

/**
 * Loads the persisted pairwise-subject HMAC secret, generating one on first run; kept separate
 * from SigningKeys since leaking it only exposes pairwise ids, not forged tokens.
 * @param {string} path
 * @returns {Buffer}
 */
export function loadOrCreateAuthSecret(path) {
    if (existsSync(path)) {
        return Buffer.from(readFileSync(path, "utf8"), "base64");
    }
    const secret = randomBytes(AUTH_SECRET_BYTES);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, secret.toString("base64"));
    return secret;
}

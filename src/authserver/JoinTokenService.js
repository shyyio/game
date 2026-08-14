import {createHmac, timingSafeEqual} from "node:crypto";

const JOIN_TOKEN_TTL_S = 300;
// A reconnect token lives as long as a play session plausibly does; it buys only fresh join tokens
// for the one origin it was minted for.
const RECONNECT_TOKEN_TTL_S = 12 * 60 * 60;

/**
 * Mints short-lived, Ed25519-signed join tokens; the subject is pairwise per (account, origin)
 * so colluding game servers can't cross-reference players.
 */
export class JoinTokenService {

    /**
     * @param {SigningKeys} signingKeys
     * @param {Buffer} authSecret
     */
    constructor(signingKeys, authSecret) {
        this._signingKeys = signingKeys;
        this._authSecret = authSecret;
    }

    /**
     * @param {AccountRecord} account
     * @param {string} origin - the target game server's canonical origin
     * @returns {string} compact signed token
     */
    mint(account, origin) {
        const nowS = Math.floor(Date.now() / 1000);
        const header = {alg: "EdDSA", kid: this._signingKeys.kid};
        const payload = {
            sub: this._pairwiseSub(account.accountId, origin),
            aud: origin,
            name: account.username,
            ent: [],
            exp: nowS + JOIN_TOKEN_TTL_S,
        };
        const signingInput = `${base64url(header)}.${base64url(payload)}`;
        const signature = this._signingKeys.sign(Buffer.from(signingInput));
        return `${signingInput}.${signature.toString("base64url")}`;
    }

    /**
     * An origin-scoped credential the game page keeps for the length of a session: it mints join
     * tokens for that one server and nothing else, so the account session never has to be readable
     * from a page that runs mod code.
     * @param {AccountRecord} account
     * @param {string} origin
     * @returns {string}
     */
    mintReconnect(account, origin) {
        const payload = base64url({
            sub: account.accountId,
            aud: origin,
            exp: Math.floor(Date.now() / 1000) + RECONNECT_TOKEN_TTL_S,
        });
        return `${payload}.${this._reconnectSignature(payload)}`;
    }

    /**
     * @param {string} token
     * @returns {{accountId: number, origin: string}|null} null when malformed, forged, or expired
     */
    verifyReconnect(token) {
        const [payload, signature] = String(token).split(".");
        if (payload === undefined || signature === undefined) {
            return null;
        }
        const expected = Buffer.from(this._reconnectSignature(payload), "base64url");
        const given = Buffer.from(signature, "base64url");
        if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
            return null;
        }
        let claims;
        try {
            claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        } catch {
            return null;
        }
        if (typeof claims.sub !== "number" || typeof claims.aud !== "string" || typeof claims.exp !== "number") {
            return null;
        }
        if (Math.floor(Date.now() / 1000) >= claims.exp) {
            return null;
        }
        return {accountId: claims.sub, origin: claims.aud};
    }

    /**
     * @private
     * @param {string} payload
     * @returns {string}
     */
    _reconnectSignature(payload) {
        return createHmac("sha256", this._authSecret).update(`reconnect:${payload}`).digest("base64url");
    }

    /**
     * @private
     * @param {number} accountId
     * @param {string} origin
     * @returns {string}
     */
    _pairwiseSub(accountId, origin) {
        return createHmac("sha256", this._authSecret).update(`${accountId}:${origin}`).digest("base64url");
    }
}

/**
 * @param {object} value
 * @returns {string}
 */
function base64url(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

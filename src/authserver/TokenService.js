import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";

const JOIN_TOKEN_TTL_S = 300;
// A reconnect token lives as long as a play session plausibly does; it buys only fresh join tokens
// for the one origin it was minted for.
const RECONNECT_TOKEN_TTL_S = 12 * 60 * 60;
// A renewal chain ends here however often it is refreshed, so a leaked reconnect token can't be
// kept alive forever.
export const RECONNECT_ABSOLUTE_TTL_S = 7 * 24 * 60 * 60;
const SESSION_TTL_S = 24 * 60 * 60;
// Makes every login's token distinct.
const SESSION_NONCE_BYTES = 8;

/**
 * Mints the auth server's tokens: Ed25519-signed join tokens whose subject is pairwise per
 * (account, origin) so colluding game servers can't cross-reference players, and HMAC-signed
 * session and reconnect tokens the server verifies without keeping any state.
 */
export class TokenService {

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
        return this._signReconnect(account.accountId, origin, Math.floor(Date.now() / 1000));
    }

    /**
     * The replacement for a reconnect token being spent, carrying the original issue time so the
     * renewal chain still ends at the absolute lifetime.
     * @param {{accountId: number, origin: string, issuedAtS: number}} claims
     * @returns {string}
     */
    renewReconnect({accountId, origin, issuedAtS}) {
        return this._signReconnect(accountId, origin, issuedAtS);
    }

    /**
     * @param {string} token
     * @returns {{accountId: number, origin: string, issuedAtS: number}|null} null when malformed,
     *     forged, expired, or past the absolute renewal lifetime
     */
    verifyReconnect(token) {
        const claims = this._verifiedClaims("reconnect", token);
        if (claims === null || typeof claims.aud !== "string" || typeof claims.iat !== "number") {
            return null;
        }
        if (Math.floor(Date.now() / 1000) >= claims.iat + RECONNECT_ABSOLUTE_TTL_S) {
            return null;
        }
        return {accountId: claims.sub, origin: claims.aud, issuedAtS: claims.iat};
    }

    /**
     * The bearer credential /login hands out; stateless, so it outlives a restart.
     * @param {number} accountId
     * @returns {string}
     */
    mintSession(accountId) {
        const payload = base64url({
            sub: accountId,
            exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
            jti: randomBytes(SESSION_NONCE_BYTES).toString("base64url"),
        });
        return `${payload}.${this._hmac(`session:${payload}`)}`;
    }

    /**
     * @param {string} token
     * @returns {number|null} the accountId, or null when malformed, forged, or expired
     */
    verifySession(token) {
        const claims = this._verifiedClaims("session", token);
        if (claims === null) {
            return null;
        }
        return claims.sub;
    }

    /**
     * The claims of an HMAC token with a valid signature, numeric subject, and unexpired `exp`.
     * @private
     * @param {string} scope - the domain-separation label the token was signed under
     * @param {string} token
     * @returns {object|null}
     */
    _verifiedClaims(scope, token) {
        const [payload, signature] = String(token).split(".");
        if (payload === undefined || signature === undefined) {
            return null;
        }
        const expected = Buffer.from(this._hmac(`${scope}:${payload}`), "base64url");
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
        if (typeof claims !== "object" || claims === null) {
            return null;
        }
        if (typeof claims.sub !== "number" || typeof claims.exp !== "number") {
            return null;
        }
        if (Math.floor(Date.now() / 1000) >= claims.exp) {
            return null;
        }
        return claims;
    }

    /**
     * @private
     * @param {number} accountId
     * @param {string} origin
     * @param {number} issuedAtS
     * @returns {string}
     */
    _signReconnect(accountId, origin, issuedAtS) {
        const payload = base64url({
            sub: accountId,
            aud: origin,
            iat: issuedAtS,
            exp: Math.floor(Date.now() / 1000) + RECONNECT_TOKEN_TTL_S,
        });
        return `${payload}.${this._hmac(`reconnect:${payload}`)}`;
    }

    /**
     * @private
     * @param {string} input
     * @returns {string} base64url
     */
    _hmac(input) {
        return createHmac("sha256", this._authSecret).update(input).digest("base64url");
    }

    /**
     * @private
     * @param {number} accountId
     * @param {string} origin
     * @returns {string}
     */
    _pairwiseSub(accountId, origin) {
        return this._hmac(`${accountId}:${origin}`);
    }
}

/**
 * @param {object} value
 * @returns {string}
 */
function base64url(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

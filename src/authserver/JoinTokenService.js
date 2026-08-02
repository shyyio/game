import {createHmac} from "node:crypto";

const JOIN_TOKEN_TTL_S = 300;

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

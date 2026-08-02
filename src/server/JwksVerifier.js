import {createPublicKey, verify} from "node:crypto";

const JWKS_PATH = "/.well-known/jwks.json";

/**
 * Offline verifier for auth-server join tokens: fetches the auth server's published keys once
 * (load()) and checks signature/audience/expiry against the cache from then on. No callback to
 * the auth server per join, per docs/auth.md.
 */
export class JwksVerifier {

    /**
     * @param {string} authServerUrl - e.g. "http://localhost:8081"
     */
    constructor(authServerUrl) {
        this._authServerUrl = authServerUrl;
        this._keysByKid = new Map();
    }

    /**
     * Fetches and caches the auth server's published keys. Must resolve before verify() is used.
     * @returns {Promise<void>}
     */
    async load() {
        const response = await fetch(`${this._authServerUrl}${JWKS_PATH}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch JWKS from ${this._authServerUrl}: ${response.status}`);
        }
        const body = await response.json();
        this._keysByKid.clear();
        for (const jwk of body.keys) {
            this._keysByKid.set(jwk.kid, createPublicKey({key: jwk, format: "jwk"}));
        }
    }

    /**
     * Verifies a compact join token's signature, audience, and expiry.
     * @param {string} token
     * @param {string} expectedAud - this server's own canonical origin
     * @returns {{sub: string, name: string, ent: string[]}|null} the claims, or null if the token
     *     is malformed, unsigned by a known key, expired, or minted for a different origin
     */
    verify(token, expectedAud) {
        const parts = token.split(".");
        if (parts.length !== 3) {
            return null;
        }
        const [headerPart, payloadPart, signaturePart] = parts;
        let header;
        let payload;
        try {
            header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
            payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
        } catch (error) {
            return null;
        }
        const publicKey = this._keysByKid.get(header.kid);
        if (publicKey === undefined) {
            return null;
        }
        const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
        const signature = Buffer.from(signaturePart, "base64url");
        if (!verify(null, signingInput, publicKey, signature)) {
            return null;
        }
        if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
            return null;
        }
        if (payload.aud !== expectedAud) {
            return null;
        }
        return {sub: payload.sub, name: payload.name, ent: payload.ent};
    }
}

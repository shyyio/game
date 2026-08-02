import {createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";

/**
 * The auth server's join-token signing identity: an Ed25519 keypair persisted to disk so
 * restarts keep the same key; only toJwk()'s public half is ever published.
 */
export class SigningKeys {

    /**
     * @param {string} path - JSON file holding the kid + PKCS8 private key PEM
     */
    constructor(path) {
        const stored = loadOrGenerate(path);
        this._kid = stored.kid;
        this._privateKey = createPrivateKey(stored.privateKeyPem);
        this._publicKey = createPublicKey(this._privateKey);
    }

    /**
     * @returns {string}
     */
    get kid() {
        return this._kid;
    }

    /**
     * The public key as a JWK, ready for the JWKS keys array.
     * @returns {object}
     */
    toJwk() {
        const jwk = this._publicKey.export({format: "jwk"});
        return {...jwk, kid: this._kid, use: "sig", alg: "EdDSA"};
    }

    /**
     * @param {Buffer} data
     * @returns {Buffer}
     */
    sign(data) {
        return sign(null, data, this._privateKey);
    }
}

/**
 * @param {string} path
 * @returns {{kid: string, privateKeyPem: string}}
 */
function loadOrGenerate(path) {
    if (existsSync(path)) {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    const {privateKey} = generateKeyPairSync("ed25519");
    const stored = {
        kid: randomBytes(8).toString("hex"),
        privateKeyPem: privateKey.export({type: "pkcs8", format: "pem"}),
    };
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, JSON.stringify(stored));
    return stored;
}

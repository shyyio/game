import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SigningKeys} from "@/authserver/SigningKeys.js";

/**
 * @returns {string} a signing-key path inside a fresh scratch directory
 */
function keyPath() {
    const dir = mkdtempSync(join(tmpdir(), "authserver-signing-keys-"));
    return join(dir, "signing-key.json");
}

test("a fresh path generates a key with an Ed25519 JWK", () => {
    const path = keyPath();
    try {
        const keys = new SigningKeys(path);
        const jwk = keys.toJwk();
        assert.equal(jwk.kty, "OKP");
        assert.equal(jwk.crv, "Ed25519");
        assert.equal(typeof jwk.x, "string");
        assert.equal(jwk.kid, keys.kid);
        assert.equal(jwk.alg, "EdDSA");
        assert.equal(jwk.use, "sig");
    } finally {
        rmSync(path, {force: true});
    }
});

test("reopening the same path reuses the same key", () => {
    const path = keyPath();
    try {
        const first = new SigningKeys(path);
        const second = new SigningKeys(path);
        assert.equal(second.kid, first.kid);
        assert.deepEqual(second.toJwk(), first.toJwk());
    } finally {
        rmSync(path, {force: true});
    }
});

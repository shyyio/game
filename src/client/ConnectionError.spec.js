import test from "node:test";
import assert from "node:assert/strict";
import {ConnectionError, requestUrl} from "@/client/ConnectionError.js";

const URL = "https://example.com/mods/index.json";

test("a request that never reached its host raises a ConnectionError", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    try {
        await assert.rejects(() => requestUrl(URL), ConnectionError);
    } finally {
        globalThis.fetch = original;
    }
});

test("an error status is the host answering, so the response comes back", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve({ok: false, status: 503});
    try {
        assert.equal((await requestUrl(URL)).status, 503);
    } finally {
        globalThis.fetch = original;
    }
});

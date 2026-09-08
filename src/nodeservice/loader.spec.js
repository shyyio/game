import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
// one plain string: console.log inspect-colors a separate argument under an inherited FORCE_COLOR
const PROBE = 'import("@/common/ModManifest.js").then(m => console.log("SDK " + m.SDK_VERSION))';

function runProbe(loader) {
    const result = spawnSync(process.execPath, [
        "--import",
        loader,
        "--input-type=module",
        "-e",
        PROBE,
    ], {cwd: repoRoot, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    return result;
}

test("the production loader resolves the @/ alias without a deprecation warning", () => {
    const result = runProbe("./src/nodeservice/loader.js");
    assert.match(result.stdout, /SDK \d+/);
    assert.doesNotMatch(result.stderr, /DeprecationWarning/);
});

test("the test loader resolves the @/ alias without a deprecation warning", () => {
    const result = runProbe("./src/test/test-loader.js");
    assert.match(result.stdout, /SDK \d+/);
    assert.doesNotMatch(result.stderr, /DeprecationWarning/);
});

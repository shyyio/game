import {test} from "node:test";
import assert from "node:assert/strict";
import {ServerConfig} from "@/common/ServerConfig.js";
import {DEFAULT_TICK_MS} from "@/common/constants.js";

test("an empty file is every default", () => {
    const config = ServerConfig.parse({});
    assert.equal(config.port, 27500);
    assert.equal(config.tickMs, DEFAULT_TICK_MS);
    assert.equal(config.seed, null);
    assert.equal(config.mods, null);
    assert.equal(config.origin, "ws://localhost:27500");
});

const PIN = {url: "https://mods.example/widgets/1.0.0/", name: "widgets", version: "1.0.0", integrity: {"mod.json": `sha256-${"a1".repeat(32)}`}};

test("a config round-trips through JSON with every field present", () => {
    const json = ServerConfig.parse({name: "Mine", seed: 42, mods: [PIN]}).toJSON();
    assert.equal(json.name, "Mine");
    assert.equal(json.seed, 42);
    assert.deepEqual(json.mods, [PIN]);
    assert.deepEqual(Object.keys(json), [
        "name", "origin", "authServer", "host", "port", "tickMs", "saveMs", "seed", "db", "metricsDb", "mods", "modsCache",
        "adminToken",
    ]);
    assert.deepEqual(ServerConfig.parse(json).toJSON(), json);
});

test("the mod list is a lockfile, checked as one", () => {
    assert.deepEqual(ServerConfig.parse({mods: [PIN]}).lockfile.mods.map(mod => mod.name), ["widgets"]);
    assert.deepEqual(ServerConfig.parse({}).lockfile.mods, []);
    assert.throws(() => ServerConfig.parse({mods: [{name: "x"}]}), /url/);
    assert.throws(() => ServerConfig.parse({mods: "mods.json"}), /mods/);
    assert.deepEqual(ServerConfig.parse({mods: []}).lockfile.mods, []);
});

test("a change to the mod list counts as a difference, an equal list does not", () => {
    const listed = ServerConfig.parse({mods: [PIN]});
    assert.deepEqual(listed.diff(ServerConfig.parse({mods: [PIN]})), []);
    assert.deepEqual(listed.diff(ServerConfig.parse({mods: [Object.assign({}, PIN, {version: "1.1.0"})]})), ["mods"]);
    assert.deepEqual(listed.diff(ServerConfig.parse({})), ["mods"]);
});

test("an unknown key, a bad origin, a bad seed, and a bad port are all refused", () => {
    assert.throws(() => ServerConfig.parse({colour: "red"}), /Unknown key "colour"/);
    assert.throws(() => ServerConfig.parse({origin: "http://x"}), /origin/);
    assert.throws(() => ServerConfig.parse({seed: -1}), /seed/);
    assert.throws(() => ServerConfig.parse({seed: "7"}), /seed/);
    assert.throws(() => ServerConfig.parse({port: 70000}), /port/);
    assert.throws(() => ServerConfig.parse({tickMs: 0}), /tickMs/);
    assert.throws(() => ServerConfig.parse({name: ""}), /name/);
});

test("overrides win over the file, and name what they set", () => {
    const config = ServerConfig.parse({port: 1234, name: "File"});
    const {config: applied, overridden} = config.withOverrides({port: 4321, seed: 9});
    assert.equal(applied.port, 4321);
    assert.equal(applied.seed, 9);
    assert.equal(applied.name, "File");
    assert.deepEqual(overridden, ["port", "seed"]);
    assert.equal(config.port, 1234);
});

test("the fields that differ between two configs are listed by name", () => {
    const saved = ServerConfig.parse({port: 1, tickMs: 500});
    const running = ServerConfig.parse({port: 2, tickMs: 500, name: "Other"});
    assert.deepEqual(saved.diff(running), ["name", "port"]);
});

test("the admin token is kept in the file but never in the public view", () => {
    const config = ServerConfig.parse({adminToken: "secret"});
    assert.equal(config.adminToken, "secret");
    assert.equal(config.toJSON().adminToken, "secret");
    assert.equal(config.toPublicJSON().adminToken, undefined);
    assert.equal(ServerConfig.parse({}).adminToken, null);
    assert.throws(() => ServerConfig.parse({adminToken: ""}), /adminToken/);
});

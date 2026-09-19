import test from "node:test";
import assert from "node:assert/strict";
import {buildSymbolicationNote} from "@/reportingserver/ReportingHttpServer.js";

test("a stack with no maps for its build says the maps are missing", () => {
    assert.equal(buildSymbolicationNote(false), "Unsymbolicated: no maps for this build.");
});

test("a stack whose build has maps that cover none of its files says so", () => {
    assert.equal(buildSymbolicationNote(true), "Unsymbolicated: this build's maps cover none of these files.");
});

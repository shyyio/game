import {test} from "node:test";
import assert from "node:assert/strict";
import {formatPastDate} from "@/common/dateFormat.js";

const NOW = new Date("2026-08-14T12:00:00Z");

test("a recent date reads as an age", () => {
    assert.equal(formatPastDate("2026-08-14T11:59:59.500Z", NOW), "just now");
    assert.equal(formatPastDate("2026-08-14T11:59:30Z", NOW), "30 seconds ago");
    assert.equal(formatPastDate("2026-08-14T09:00:00Z", NOW), "3 hours ago");
    assert.equal(formatPastDate("2026-08-13T12:00:00Z", NOW), "1 day ago");
    assert.equal(formatPastDate("2026-06-14T12:00:00Z", NOW), "2 months ago");
    assert.equal(formatPastDate("2025-09-14T12:00:00Z", NOW), "11 months ago");
});

test("twelve months or older reads as an absolute date", () => {
    assert.equal(formatPastDate("2025-08-14T12:00:00Z", NOW), "Aug 14, 2025");
    assert.equal(formatPastDate("2024-07-15T12:00:00Z", NOW), "Jul 15, 2024");
});

test("a day short of twelve months is still an age", () => {
    assert.equal(formatPastDate("2025-08-15T12:00:00Z", NOW), "11 months ago");
});

test("a skewed future timestamp reads as just now", () => {
    assert.equal(formatPastDate("2026-08-14T12:00:05Z", NOW), "just now");
});

test("a malformed date throws", () => {
    assert.throws(() => formatPastDate("not-a-date", NOW), /Not a date/);
});

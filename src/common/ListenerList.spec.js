import {test} from "node:test";
import assert from "node:assert";

import {ListenerList} from "@/common/ListenerList.js";

test("notify calls every listener with the arguments", () => {
    const list = new ListenerList();
    const calls = [];
    list.add((a, b) => calls.push(["first", a, b]));
    list.add((a, b) => calls.push(["second", a, b]));

    list.notify(1, 2);

    assert.deepStrictEqual(calls, [["first", 1, 2], ["second", 1, 2]]);
});

test("unsubscribe removes only its listener", () => {
    const list = new ListenerList();
    const calls = [];
    const unsubscribe = list.add(() => calls.push("first"));
    list.add(() => calls.push("second"));

    unsubscribe();
    list.notify();

    assert.deepStrictEqual(calls, ["second"]);
});

test("unsubscribing twice is a no-op", () => {
    const list = new ListenerList();
    const calls = [];
    const unsubscribe = list.add(() => calls.push("first"));
    list.add(() => calls.push("second"));

    unsubscribe();
    unsubscribe();
    list.notify();

    assert.deepStrictEqual(calls, ["second"]);
});

test("a listener unsubscribing itself mid-notify does not skip the next listener", () => {
    const list = new ListenerList();
    const calls = [];
    const unsubscribe = list.add(() => {
        calls.push("first");
        unsubscribe();
    });
    list.add(() => calls.push("second"));

    list.notify();
    list.notify();

    assert.deepStrictEqual(calls, ["first", "second", "second"]);
});

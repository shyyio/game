import {test} from "node:test";
import {wireRegistryFor, assertRoundTrip} from "@/test/wireRoundTrip.js";
import {PebbleGeneratorDeclaration} from "../declaration.js";
import {GeneratorCountRequestMessage} from "./messages.js";
import {GeneratorCountEvent} from "./events.js";

test("the count request and its answer survive the wire", () => {
    const reg = wireRegistryFor(new PebbleGeneratorDeclaration());
    assertRoundTrip(reg, new GeneratorCountRequestMessage(), GeneratorCountRequestMessage);
    assertRoundTrip(reg, new GeneratorCountEvent(3), GeneratorCountEvent);
});

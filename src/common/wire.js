
import protobuf from "protobufjs";

import {SetViewportMessage} from "@/common/CoreMessages.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";

const {Type, Field, MapField} = protobuf;
const Long = protobuf.util.Long;

const INT64_TYPES = new Set(["int64", "uint64", "sint64", "fixed64", "sfixed64"]);

/**
 * Core message/event classes that travel over the wire. Mods contribute the rest
 * via Mod.wireClasses. Order here is part of the wire-id assignment contract, so
 * only ever append.
 * @type {Function[]}
 */
const CORE_WIRE_CLASSES = [
    SetViewportMessage,
    BufferedEvent,
    PlayerSettingsSyncEvent,
    PlayerSettingsUpdateEvent,
    GameSettingsSyncEvent,
    GameSettingsUpdateEvent,
];

/**
 * Envelope wrapping every encoded frame: a wire id identifying the concrete class
 * plus the encoded body.
 */
const Envelope = new Type("Envelope")
    .add(new Field("wireId", 1, "uint32"))
    .add(new Field("payload", 2, "bytes"));

/**
 * Parses a wireFields spec string into a descriptor.
 *   "int32"            -> scalar
 *   "int64?"           -> nullable scalar (cosmetic: all scalars are optional)
 *   "string[]"         -> repeated
 *   "map<int32,int32>" -> map
 * @param {string} spec
 * @returns {{kind: string, type: string, keyType?: string, int64: boolean}}
 */
function parseSpec(spec) {
    const mapMatch = spec.match(/^map<\s*(\w+)\s*,\s*(\w+)\s*>$/);
    if (mapMatch) {
        return {kind: "map", keyType: mapMatch[1], type: mapMatch[2], int64: INT64_TYPES.has(mapMatch[2])};
    }
    if (spec.endsWith("[]")) {
        const type = spec.slice(0, -2);
        return {kind: "repeated", type, int64: INT64_TYPES.has(type)};
    }
    const type = spec.endsWith("?") ? spec.slice(0, -1) : spec;
    return {kind: "scalar", type, int64: INT64_TYPES.has(type)};
}

/**
 * Builds a protobufjs Type from a class's static wireFields. Scalars are marked
 * `optional` so explicit presence is tracked — that preserves zero/empty values
 * (e.g. x:0, EVENT_TYPE_CORE:0) and lets absent fields decode back to null.
 * @param {string} name
 * @param {Object.<string, string>} wireFields
 * @returns {{type: protobuf.Type, specs: Object.<string, object>}}
 */
function buildType(name, wireFields) {
    const type = new Type(name);
    const specs = {};
    let tag = 1;
    Object.entries(wireFields).forEach(([fieldName, spec]) => {
        const parsed = parseSpec(spec);
        specs[fieldName] = parsed;
        if (parsed.kind === "map") {
            type.add(new MapField(fieldName, tag, parsed.keyType, parsed.type));
        } else if (parsed.kind === "repeated") {
            type.add(new Field(fieldName, tag, parsed.type, "repeated"));
        } else {
            type.add(new Field(fieldName, tag, parsed.type, "optional"));
        }
        tag += 1;
    });
    return {type, specs};
}

export class WireRegistry {

    /**
     * @param {ModRegistry} modRegistry
     */
    constructor(modRegistry) {
        /** @type {Map<Function, object>} */
        this.byClass = new Map();
        /** @type {Map<number, object>} */
        this.byId = new Map();

        const classes = CORE_WIRE_CLASSES.concat(modRegistry.wireClasses);
        classes.forEach((cls, index) => {
            if (cls.wireFields === undefined) {
                throw new Error(`Class ${cls.name} is registered for the wire but has no static wireFields`);
            }
            const wireId = index + 1;
            const {type, specs} = buildType(cls.name, cls.wireFields);
            const codec = {cls, wireId, type, specs};
            this.byClass.set(cls, codec);
            this.byId.set(wireId, codec);
        });
    }

    /**
     * Encodes a message/event instance to protobuf bytes. BigInt fields are
     * converted to int64 automatically.
     * @param {object} obj
     * @returns {Uint8Array}
     */
    encode(obj) {
        const codec = this.byClass.get(obj.constructor);
        if (codec === undefined) {
            throw new Error(`No wire codec registered for ${obj.constructor.name}`);
        }

        const payload = {};
        Object.entries(codec.specs).forEach(([name, spec]) => {
            const value = obj[name];
            if (spec.kind === "repeated") {
                const arr = value == null ? [] : value;
                payload[name] = spec.int64 ? arr.map(toLong) : arr;
            } else if (spec.kind === "map") {
                payload[name] = value == null ? {} : value;
            } else if (value != null) {
                payload[name] = spec.int64 ? toLong(value) : value;
            }
        });

        const body = codec.type.encode(codec.type.create(payload)).finish();
        return Envelope.encode(Envelope.create({wireId: codec.wireId, payload: body})).finish();
    }

    /**
     * Decodes protobuf bytes back into a message/event instance. int64 fields are
     * converted back to BigInt; absent scalar fields become null.
     * @param {Uint8Array} bytes
     * @returns {object}
     */
    decode(bytes) {
        const envelope = Envelope.decode(bytes);
        const codec = this.byId.get(envelope.wireId);
        if (codec === undefined) {
            throw new Error(`No wire codec registered for wire id ${envelope.wireId}`);
        }

        const raw = codec.type.toObject(codec.type.decode(envelope.payload), {longs: String});

        const fields = {};
        Object.entries(codec.specs).forEach(([name, spec]) => {
            if (spec.kind === "repeated") {
                const arr = raw[name] === undefined ? [] : raw[name];
                fields[name] = spec.int64 ? arr.map(v => BigInt(v)) : arr;
            } else if (spec.kind === "map") {
                fields[name] = raw[name] === undefined ? {} : raw[name];
            } else if (name in raw) {
                fields[name] = spec.int64 ? BigInt(raw[name]) : raw[name];
            } else {
                fields[name] = null;
            }
        });

        return Object.assign(Object.create(codec.cls.prototype), fields);
    }
}

/**
 * @param {BigInt|number} value
 * @returns {Long}
 */
function toLong(value) {
    return Long.fromString(value.toString());
}

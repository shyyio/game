import protobuf from "protobufjs";

import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {PortItemSetEvent, PortItemClearEvent, PortItemBatchEvent} from "@/common/PortItemEvents.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {InspectHeartbeatEvent, InspectClosedEvent} from "@/common/InspectEvents.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent, ObjectSyncBatchEvent} from "@/common/ObjectEvents.js";
import {LaborAssignmentEvent, LaborAssignmentBatchEvent} from "@/common/LaborEvents.js";

const {Type, Field, MapField, Root} = protobuf;
const Long = protobuf.util.Long;

const INT64_TYPES = new Set(["int64", "uint64", "sint64", "fixed64", "sfixed64"]);

/**
 * Core wire classes; order is part of the wire-id contract, so only ever append.
 * @type {*[]}
 */
const CORE_WIRE_CLASSES = [
    SetViewportMessage,
    PortItemSetEvent,
    PortItemClearEvent,
    PlayerSettingsSyncEvent,
    PlayerSettingsUpdateEvent,
    GameSettingsSyncEvent,
    GameSettingsUpdateEvent,
    ChunkSubscribeEvent,
    ChunkUnsubscribeEvent,
    ChunkSyncEvent,
    DeleteObjectMessage,
    CreateObjectMessage,
    ObjectInsertEvent,
    ObjectSyncEvent,
    ObjectDeleteEvent,
    SetInspectedObjectsMessage,
    InspectHeartbeatEvent,
    InspectClosedEvent,
    PortItemBatchEvent,
    ObjectSyncBatchEvent,
    LaborAssignmentEvent,
    LaborAssignmentBatchEvent,
];

/**
 * Parses a wireFields spec string into a descriptor.
 *   "int32"            -> scalar
 *   "int64?"           -> nullable scalar (cosmetic: all scalars are optional)
 *   "string[]"         -> repeated
 *   "map<int32,int32>" -> map
 *   "message[]"        -> a repeated, polymorphic list of wire objects, encoded
 *                         as two columns — wire ids and encoded bodies (lets one
 *                         message/event bundle others of any registered class)
 * @param {string} spec
 * @returns {{kind: string, type?: string, keyType?: string, int64?: boolean}}
 */
function parseSpec(spec) {
    if (spec === "message[]") {
        return {kind: "messages"};
    }
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
 * Builds a protobufjs Type from a class's wireFields, marking scalars optional to preserve zeros and decode absences to null.
 * @param {string} name
 * @param {Object.<string, string>} wireFields
 * @returns {{type: protobuf.Type, specs: Object.<string, object>}}
 */
function buildType(name, wireFields) {
    const type = new Type(name);
    const specs = {};
    let tag = 1;
    for (const [fieldName, spec] of Object.entries(wireFields)) {
        const parsed = parseSpec(spec);
        specs[fieldName] = parsed;
        if (parsed.kind === "map") {
            type.add(new MapField(fieldName, tag, parsed.keyType, parsed.type));
        } else if (parsed.kind === "messages") {
            // Columnar: the bundled wire objects' ids and bodies as parallel columns.
            type.add(new Field(`${fieldName}WireIds`, tag, "uint32", "repeated"));
            tag += 1;
            type.add(new Field(`${fieldName}Payloads`, tag, "bytes", "repeated"));
        } else if (parsed.kind === "repeated") {
            // Reflection-built fields default to proto2's expanded encoding (one tag byte per
            // element); packed writes the tag once. Strings stay expanded (not packable).
            const packable = parsed.type !== "string" && parsed.type !== "bytes";
            type.add(new Field(fieldName, tag, parsed.type, "repeated", undefined, packable ? {packed: true} : undefined));
        } else {
            type.add(new Field(fieldName, tag, parsed.type, "optional"));
        }
        tag += 1;
    }
    return {type, specs};
}

/**
 * @returns {protobuf.Type} a fresh Envelope type: the top-level wire id plus encoded body framing.
 */
function buildEnvelope() {
    return new Type("Envelope")
        .add(new Field("wireId", 1, "uint32"))
        .add(new Field("payload", 2, "bytes"));
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

        this.root = new Root();
        this.envelope = buildEnvelope();
        this.root.add(this.envelope);

        const classes = CORE_WIRE_CLASSES.concat(modRegistry.wireClasses);
        for (const [index, cls] of classes.entries()) {
            if (cls.wireFields === undefined) {
                throw new Error(`Class ${cls.name} is registered for the wire but has no static wireFields`);
            }
            const wireId = index + 1;
            const {type, specs} = buildType(cls.name, cls.wireFields);
            this.root.add(type);
            const codec = {cls, wireId, type, specs};
            this.byClass.set(cls, codec);
            this.byId.set(wireId, codec);
        }

        this.root.resolveAll();
    }

    /**
     * Encodes a message/event instance to protobuf bytes (Number → int64).
     * @param {object} obj
     * @returns {Uint8Array}
     */
    encode(obj) {
        const {wireId, body} = this._encodeBody(obj);
        return this.envelope.encode(this.envelope.create({wireId, payload: body})).finish();
    }

    /**
     * Encodes an instance's body with its class's codec.
     * @private
     * @param {object} obj
     * @returns {{wireId: number, body: Uint8Array}}
     */
    _encodeBody(obj) {
        const codec = this.byClass.get(obj.constructor);
        if (codec === undefined) {
            throw new Error(`No wire codec registered for ${obj.constructor.name}`);
        }

        const payload = {};
        for (const [name, spec] of Object.entries(codec.specs)) {
            const value = obj[name];
            if (spec.kind === "repeated") {
                const arr = value == null ? [] : value;
                payload[name] = spec.int64 ? arr.map(toLong) : arr;
            } else if (spec.kind === "messages") {
                const arr = value == null ? [] : value;
                const wireIds = [];
                const bodies = [];
                for (const message of arr) {
                    const inner = this._encodeBody(message);
                    wireIds.push(inner.wireId);
                    bodies.push(inner.body);
                }
                payload[`${name}WireIds`] = wireIds;
                payload[`${name}Payloads`] = bodies;
            } else if (spec.kind === "map") {
                payload[name] = value == null ? {} : value;
            } else if (value != null) {
                payload[name] = spec.int64 ? toLong(value) : value;
            }
        }

        const body = codec.type.encode(codec.type.create(payload)).finish();
        return {wireId: codec.wireId, body};
    }

    /**
     * Decodes protobuf bytes into a message/event instance (int64 → Number, absent scalars → null).
     * @param {Uint8Array} bytes
     * @returns {object}
     */
    decode(bytes) {
        const envelope = this.envelope.decode(bytes);
        return this._decodeBody(envelope.wireId, envelope.payload);
    }

    /**
     * Rebuilds an instance from its wire id and encoded body.
     * @private
     * @param {number} wireId
     * @param {Uint8Array} body
     * @returns {object}
     */
    _decodeBody(wireId, body) {
        const codec = this.byId.get(wireId);
        if (codec === undefined) {
            throw new Error(`No wire codec registered for wire id ${wireId}`);
        }

        // longs: Number decodes int64 straight to Number — ids are capped at 2^53 sim-wide, and a
        // String round-trip would allocate per int64 field per message.
        const raw = codec.type.toObject(codec.type.decode(body), {longs: Number});

        const fields = {};
        for (const [name, spec] of Object.entries(codec.specs)) {
            if (spec.kind === "repeated") {
                fields[name] = raw[name] === undefined ? [] : raw[name];
            } else if (spec.kind === "messages") {
                const wireIds = raw[`${name}WireIds`] === undefined ? [] : raw[`${name}WireIds`];
                const bodies = raw[`${name}Payloads`] === undefined ? [] : raw[`${name}Payloads`];
                fields[name] = wireIds.map((innerId, index) => this._decodeBody(innerId, bodies[index]));
            } else if (spec.kind === "map") {
                fields[name] = raw[name] === undefined ? {} : raw[name];
            } else if (name in raw) {
                fields[name] = raw[name];
            } else {
                fields[name] = null;
            }
        }

        return Object.assign(Object.create(codec.cls.prototype), fields);
    }
}

/**
 * @param {number} value
 * @returns {Long}
 */
function toLong(value) {
    return Long.fromNumber(value);
}

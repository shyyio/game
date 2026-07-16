import protobuf from "protobufjs";

import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {InspectHeartbeatEvent, InspectClosedEvent} from "@/common/InspectEvents.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";

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
];

/**
 * Parses a wireFields spec string into a descriptor.
 *   "int32"            -> scalar
 *   "int64?"           -> nullable scalar (cosmetic: all scalars are optional)
 *   "string[]"         -> repeated
 *   "map<int32,int32>" -> map
 *   "message[]"        -> a repeated, polymorphic list of wire objects, each a
 *                         nested Envelope message (lets one message/event bundle
 *                         others of any registered class)
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
    Object.entries(wireFields).forEach(([fieldName, spec]) => {
        const parsed = parseSpec(spec);
        specs[fieldName] = parsed;
        if (parsed.kind === "map") {
            type.add(new MapField(fieldName, tag, parsed.keyType, parsed.type));
        } else if (parsed.kind === "messages") {
            // A bundle of other wire objects, each a nested Envelope message so
            // protobuf models the nesting natively (rather than opaque bytes).
            type.add(new Field(fieldName, tag, "Envelope", "repeated"));
        } else if (parsed.kind === "repeated") {
            type.add(new Field(fieldName, tag, parsed.type, "repeated"));
        } else {
            type.add(new Field(fieldName, tag, parsed.type, "optional"));
        }
        tag += 1;
    });
    return {type, specs};
}

/**
 * @returns {protobuf.Type} a fresh Envelope type: a wire id plus the encoded body.
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

        // Every type lives in one Root so a `message[]` field can resolve the
        // Envelope message type by name and nest it directly.
        this.root = new Root();
        this.envelope = buildEnvelope();
        this.root.add(this.envelope);

        const classes = CORE_WIRE_CLASSES.concat(modRegistry.wireClasses);
        classes.forEach((cls, index) => {
            if (cls.wireFields === undefined) {
                throw new Error(`Class ${cls.name} is registered for the wire but has no static wireFields`);
            }
            const wireId = index + 1;
            const {type, specs} = buildType(cls.name, cls.wireFields);
            this.root.add(type);
            const codec = {cls, wireId, type, specs};
            this.byClass.set(cls, codec);
            this.byId.set(wireId, codec);
        });

        this.root.resolveAll();
    }

    /**
     * Encodes a message/event instance to protobuf bytes (Number → int64).
     * @param {object} obj
     * @returns {Uint8Array}
     */
    encode(obj) {
        return this.envelope.encode(this.envelope.create(this._toEnvelope(obj))).finish();
    }

    /**
     * Builds the `{wireId, payload}` envelope for an instance — its body tagged with its class's wire id.
     * @private
     * @param {object} obj
     * @returns {{wireId: number, payload: Uint8Array}}
     */
    _toEnvelope(obj) {
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
            } else if (spec.kind === "messages") {
                const arr = value == null ? [] : value;
                payload[name] = arr.map(message => this._toEnvelope(message));
            } else if (spec.kind === "map") {
                payload[name] = value == null ? {} : value;
            } else if (value != null) {
                payload[name] = spec.int64 ? toLong(value) : value;
            }
        });

        const body = codec.type.encode(codec.type.create(payload)).finish();
        return {wireId: codec.wireId, payload: body};
    }

    /**
     * Decodes protobuf bytes into a message/event instance (int64 → Number, absent scalars → null).
     * @param {Uint8Array} bytes
     * @returns {object}
     */
    decode(bytes) {
        return this._fromEnvelope(this.envelope.decode(bytes));
    }

    /**
     * Rebuilds an instance from a decoded envelope — a message or a plain
     * `{wireId, payload}` object (as nested `message[]` elements arrive).
     * @private
     * @param {{wireId: number, payload: Uint8Array}} envelope
     * @returns {object}
     */
    _fromEnvelope(envelope) {
        const codec = this.byId.get(envelope.wireId);
        if (codec === undefined) {
            throw new Error(`No wire codec registered for wire id ${envelope.wireId}`);
        }

        const raw = codec.type.toObject(codec.type.decode(envelope.payload), {longs: String});

        const fields = {};
        Object.entries(codec.specs).forEach(([name, spec]) => {
            if (spec.kind === "repeated") {
                const arr = raw[name] === undefined ? [] : raw[name];
                fields[name] = spec.int64 ? arr.map(v => Number(v)) : arr;
            } else if (spec.kind === "messages") {
                const arr = raw[name] === undefined ? [] : raw[name];
                fields[name] = arr.map(sub => this._fromEnvelope(sub));
            } else if (spec.kind === "map") {
                fields[name] = raw[name] === undefined ? {} : raw[name];
            } else if (name in raw) {
                fields[name] = spec.int64 ? Number(raw[name]) : raw[name];
            } else {
                fields[name] = null;
            }
        });

        return Object.assign(Object.create(codec.cls.prototype), fields);
    }
}

/**
 * @param {number} value
 * @returns {Long}
 */
function toLong(value) {
    return Long.fromString(value.toString());
}

import {
    Buffer,
    BufferUsage,
    Geometry,
    Mesh,
    Matrix,
    Shader,
    compileHighShaderGlProgram,
    compileHighShaderGpuProgram,
    localUniformBit,
    localUniformBitGl,
    roundPixelsBit,
    roundPixelsBitGl,
    textureBit,
    textureBitGl,
} from "pixi.js";
import {ANIMATION_FRAME_COUNT} from "@/client/animation.js";
import {TileMeshColumns, writeTile} from "@/client/tileMeshGeometry.js";

// Attribute slots. The WGSL compiler sorts vertex inputs by name before assigning locations, so
// these follow "aPosition" < "aSequence" < "aUV" rather than the order the bits declare them.
const LOCATION_POSITION = 0;
const LOCATION_SEQUENCE = 1;
const LOCATION_UV = 2;

/**
 * Shader bit resolving a tile's uv from its sequence and the shared animation frame. The frame rects
 * are a uniform table sized to the sequences in play: WebGL2 only guarantees 256 vertex uniform
 * vectors, which a fixed upper bound would spend on frames nothing draws.
 * @param {number} frameCount
 * @returns {object}
 */
function animatedFrameBit(frameCount) {
    return {
        name: "animated-frame-bit",
        vertex: {
            header: /* wgsl */ `
                @in aSequence: f32;

                struct FrameUniforms {
                    uFrames: array<vec4<f32>, ${frameCount}>,
                    uFrame: f32,
                }

                @group(2) @binding(3) var<uniform> frameUniforms : FrameUniforms;
            `,
            main: /* wgsl */ `
                let slot = u32(aSequence) * ${ANIMATION_FRAME_COUNT}u + u32(frameUniforms.uFrame);
                let rect = frameUniforms.uFrames[slot];
                uv = rect.xy + uv * rect.zw;
            `,
        },
    };
}

/**
 * @param {number} frameCount
 * @returns {object}
 */
function animatedFrameBitGl(frameCount) {
    return {
        name: "animated-frame-bit",
        vertex: {
            header: /* glsl */ `
                in float aSequence;

                uniform vec4 uFrames[${frameCount}];
                uniform float uFrame;
            `,
            main: /* glsl */ `
                int slot = int(aSequence) * ${ANIMATION_FRAME_COUNT} + int(uFrame);
                vec4 rect = uFrames[slot];
                uv = rect.xy + uv * rect.zw;
            `,
        },
    };
}

/**
 * The uv rect of every frame of every animated sequence, flattened into the shader's lookup table.
 * Every sequence must be complete and share one atlas page, since the mesh binds a single sampler.
 */
export class FrameTable {

    /**
     * @param {TextureRegistry} textureRegistry
     * @param {string[]} sequenceNames - base sequence names, in the slot order tiles reference
     */
    constructor(textureRegistry, sequenceNames) {
        if (sequenceNames.length === 0) {
            throw new Error("A frame table needs at least one sequence");
        }
        /**
         * Sequence name -> its slot in the table.
         * @type {Map<string, number>}
         * @private
         */
        this._slots = new Map();
        /**
         * The atlas page every frame samples from.
         * @type {TextureSource|null}
         */
        this.source = null;
        this.frameCount = sequenceNames.length * ANIMATION_FRAME_COUNT;
        this.uniforms = new Float32Array(this.frameCount * 4);

        for (const [slot, name] of sequenceNames.entries()) {
            this._addSequence(slot, name, textureRegistry);
        }
    }

    /**
     * @param {number} slot
     * @param {string} name
     * @param {TextureRegistry} textureRegistry
     * @returns {void}
     * @private
     */
    _addSequence(slot, name, textureRegistry) {
        const frames = textureRegistry.getAnimation(name);
        if (frames === undefined) {
            throw new Error(`Unknown animation sequence: "${name}"`);
        }
        if (frames.length !== ANIMATION_FRAME_COUNT) {
            throw new Error(`Sequence "${name}" has ${frames.length} frames, expected ${ANIMATION_FRAME_COUNT}`);
        }
        this._slots.set(name, slot);

        for (const [index, texture] of frames.entries()) {
            const source = texture.source;
            if (this.source === null) {
                this.source = source;
            } else if (this.source !== source) {
                throw new Error(`Sequence "${name}" spans a second atlas page; animated frames must share one`);
            }
            // Normalized so the shader needs no atlas dimensions.
            const at = (slot * ANIMATION_FRAME_COUNT + index) * 4;
            this.uniforms[at] = texture.frame.x / source.width;
            this.uniforms[at + 1] = texture.frame.y / source.height;
            this.uniforms[at + 2] = texture.frame.width / source.width;
            this.uniforms[at + 3] = texture.frame.height / source.height;
        }
    }

    /**
     * The table slot a sequence animates through, throwing when it isn't registered.
     * @param {string} name
     * @returns {number}
     */
    slotOf(name) {
        const slot = this._slots.get(name);
        if (slot === undefined) {
            throw new Error(`Sequence "${name}" is not in the frame table`);
        }
        return slot;
    }
}

/**
 * The shader every {@link AnimatedTileMesh} off one frame table draws with. Shared rather than per
 * mesh, so a layer advances all its chunks with one uniform write.
 */
export class AnimatedTileShader extends Shader {

    /**
     * @param {FrameTable} frameTable
     */
    constructor(frameTable) {
        super({
            glProgram: compileHighShaderGlProgram({
                name: "animated-tile",
                bits: [localUniformBitGl, textureBitGl, animatedFrameBitGl(frameTable.frameCount), roundPixelsBitGl],
            }),
            gpuProgram: compileHighShaderGpuProgram({
                name: "animated-tile",
                bits: [localUniformBit, textureBit, animatedFrameBit(frameTable.frameCount), roundPixelsBit],
            }),
            resources: {
                uTexture: frameTable.source,
                uSampler: frameTable.source.style,
                textureUniforms: {
                    uTextureMatrix: {type: "mat3x3<f32>", value: new Matrix()},
                },
                frameUniforms: {
                    uFrames: {type: "vec4<f32>", size: frameTable.frameCount, value: frameTable.uniforms},
                    uFrame: {type: "f32", value: 0},
                },
            },
        });
    }

    /**
     * Advances every tile drawn with this shader to the shared animation frame, in [0, 8).
     * @param {number} value
     */
    set frame(value) {
        this.resources.frameUniforms.uniforms.uFrame = value;
    }
}

/**
 * One tile an {@link AnimatedTileMesh} draws.
 */
export class AnimatedTile {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} quarterTurns - clockwise 90-degree turns
     * @param {number} sequence - frame table slot
     */
    constructor(
        tileX,
        tileY,
        quarterTurns,
        sequence,
    ) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.quarterTurns = quarterTurns;
        this.sequence = sequence;
    }
}

/**
 * One draw call covering a group of animated tiles: their quads are baked into a mesh whose vertices
 * never change as the animation runs, so a frame costs no per-tile work. Rebuilt only when the
 * group's tiles change.
 */
export class AnimatedTileMesh extends Mesh {

    /**
     * @param {AnimatedTileShader} shader
     */
    constructor(shader) {
        const geometry = new Geometry({
            attributes: {
                aPosition: {
                    buffer: new Buffer({data: new Float32Array(0), usage: BufferUsage.VERTEX | BufferUsage.COPY_DST}),
                    format: "float32x2",
                    location: LOCATION_POSITION,
                },
                aSequence: {
                    buffer: new Buffer({data: new Float32Array(0), usage: BufferUsage.VERTEX | BufferUsage.COPY_DST}),
                    format: "float32",
                    location: LOCATION_SEQUENCE,
                },
                aUV: {
                    buffer: new Buffer({data: new Float32Array(0), usage: BufferUsage.VERTEX | BufferUsage.COPY_DST}),
                    format: "float32x2",
                    location: LOCATION_UV,
                },
            },
            indexBuffer: new Buffer({data: new Uint32Array(0), usage: BufferUsage.INDEX | BufferUsage.COPY_DST}),
        });
        super({geometry, shader});
    }

    /**
     * Replaces the mesh's tiles, rebuilding its quads.
     * @param {AnimatedTile[]} tiles
     * @returns {void}
     */
    setTiles(tiles) {
        const columns = new TileMeshColumns(tiles.length);
        for (const [index, tile] of tiles.entries()) {
            writeTile(columns, index, tile.tileX, tile.tileY, tile.quarterTurns, tile.sequence);
        }
        const attributes = this.geometry.attributes;
        attributes.aPosition.buffer.data = columns.positions;
        attributes.aSequence.buffer.data = columns.sequences;
        attributes.aUV.buffer.data = columns.uvs;
        this.geometry.indexBuffer.data = columns.indices;
    }

    /**
     * Drops the mesh's vertex buffers, which pixi's Mesh detaches but does not free. The shader is
     * shared across meshes, so it is left alone.
     * @param {object|boolean} [options]
     * @returns {void}
     */
    destroy(options) {
        this.geometry.destroy(true);
        super.destroy(options);
    }
}

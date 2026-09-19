import {
    Buffer,
    BufferImageSource,
    BufferUsage,
    Geometry,
    GlProgram,
    Mesh,
    Shader,
    compileHighShaderGl,
    compileHighShaderGpuProgram,
    fragmentGlTemplate,
    globalUniformsBitGl,
    localUniformBit,
    localUniformBitGl,
    roundPixelsBit,
    roundPixelsBitGl,
    vertexGlTemplate,
} from "pixi.js";
import {CHUNK_PX, TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkOrigin} from "@/common/util.js";
import {BLEND_WEIGHT_SCALE} from "@/common/Terrain.js";
import {ditherThreshold} from "@/client/layers/DitherPatterns.js";

// Attribute slots. The WGSL compiler sorts vertex inputs by name before assigning locations, so
// these follow "aPosition" < "aUV".
const LOCATION_POSITION = 0;
const LOCATION_UV = 1;

// Per cell: the uv origin of its frame in the sheet, then the frame's size in pixels.
const CELL_FLOATS = 4;
// A biome that declares no transition art.
export const NO_SLOT = -1;
// A baked weight tops out at a 50/50 mix on the biome line, where the transition art takes the tile
// whole; from there it thins out to nothing at the edge of the blend band.
const TRANSITION_SHARE_PER_UNIT = 2 / BLEND_WEIGHT_SCALE;

// The chunk quad, counter-clockwise from its top-left corner.
const QUAD_POSITIONS = new Float32Array([0, 0, CHUNK_PX, 0, CHUNK_PX, CHUNK_PX, 0, CHUNK_PX]);
const QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

/**
 * Shader bit painting a chunk from its biome-index texture: the tile's biome picks a cell of the
 * terrain sheet, and the fragment's position within the cell wraps the cell's tiling art over the
 * ground. The wrap is a texel index computed by hand rather than a repeating sampler, which an
 * atlas cell cannot have.
 * @param {number} cellCount
 * @returns {object}
 */
function terrainBit(cellCount) {
    return {
        name: "terrain-bit",
        fragment: {
            header: /* wgsl */ `
                @group(2) @binding(0) var uTexture: texture_2d<f32>;
                @group(2) @binding(1) var uSampler: sampler;
                @group(2) @binding(2) var uIndexTexture: texture_2d<f32>;
                @group(2) @binding(3) var uIndexSampler: sampler;

                struct TerrainUniforms {
                    uCells: array<vec4<f32>, ${cellCount}>,
                    uTexelSize: vec2<f32>,
                }

                @group(2) @binding(4) var<uniform> terrainUniforms : TerrainUniforms;
            `,
            main: /* wgsl */ `
                let chunkPx = vUV * ${CHUNK_PX}.0;
                let tileUV = (floor(chunkPx / ${TILE_SIZE}.0) + 0.5) / ${CHUNK_SIZE}.0;
                let biome = u32(textureSample(uIndexTexture, uIndexSampler, tileUV).r * 255.0 + 0.5);
                let cell = terrainUniforms.uCells[biome];
                if (cell.z < 1.0) {
                    outColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);
                } else {
                    let local = min(floor(chunkPx % cell.zw), cell.zw - 1.0);
                    outColor = textureSample(uTexture, uSampler, cell.xy + (local + 0.5) * terrainUniforms.uTexelSize);
                }
            `,
        },
    };
}

/**
 * The same, in glsl. Pixi compiles its gl programs at ESSL 1.00, which indexes a uniform array by
 * loop symbols only, so the cell lookup walks the table.
 * @param {number} cellCount
 * @returns {object}
 */
function terrainBitGl(cellCount) {
    return {
        name: "terrain-bit",
        fragment: {
            header: /* glsl */ `
                uniform sampler2D uTexture;
                uniform sampler2D uIndexTexture;
                uniform vec4 uCells[${cellCount}];
                uniform vec2 uTexelSize;
            `,
            main: /* glsl */ `
                vec2 chunkPx = vUV * ${CHUNK_PX}.0;
                vec2 tileUV = (floor(chunkPx / ${TILE_SIZE}.0) + 0.5) / ${CHUNK_SIZE}.0;
                int biome = int(texture(uIndexTexture, tileUV).r * 255.0 + 0.5);
                vec4 cell = vec4(0.0);
                for (int slot = 0; slot < ${cellCount}; slot++) {
                    if (slot == biome) {
                        cell = uCells[slot];
                        break;
                    }
                }
                if (cell.z < 1.0) {
                    outColor = vec4(0.0);
                } else {
                    vec2 local = min(floor(mod(chunkPx, cell.zw)), cell.zw - 1.0);
                    outColor = texture(uTexture, cell.xy + (local + 0.5) * uTexelSize);
                }
            `,
        },
    };
}

/**
 * Where each biome's ground art sits in the terrain sheet, as the shader's lookup table, plus the
 * programs every {@link TerrainMesh} compiles once and shares. Every biome with art must draw from
 * one sheet, since a mesh binds a single ground sampler.
 */
export class TerrainCellTable {

    /**
     * @param {Biome[]} biomes in biomeId order (ModRegistry.biomes)
     * @param {TextureCache} textureCache
     */
    constructor(biomes, textureCache) {
        this.cellCount = biomes.length;
        const transitionCount = biomes.filter(biome => biome.transition !== null).length;
        this.uniforms = new Float32Array((this.cellCount + transitionCount) * CELL_FLOATS);
        this.texelSize = new Float32Array(2);
        /**
         * The sheet every cell samples from, null while no biome has art.
         * @type {TextureSource|null}
         */
        this.source = null;
        this.coversEveryBiome = true;
        /**
         * biomeId -> the slot its transition art sits in, NO_SLOT without any.
         * @type {Int16Array}
         */
        this.transitionSlots = new Int16Array(biomes.length).fill(NO_SLOT);
        for (const [biomeId, biome] of biomes.entries()) {
            if (biome.texture === null) {
                this.coversEveryBiome = false;
            } else {
                this._addCell(biomeId, biome.name, biome.texture, textureCache);
            }
        }
        for (const [biomeId, biome] of biomes.entries()) {
            if (biome.transition !== null) {
                this.transitionSlots[biomeId] = this.cellCount;
                this.cellCount += 1;
                this._addCell(this.transitionSlots[biomeId], biome.name, biome.transition, textureCache);
            }
        }
        // Pixi's own gl programs run at mediump, where a chunk's pixel span is past what a half
        // float resolves and the wrap lands on the wrong texel.
        this.glProgram = new GlProgram({
            name: "terrain",
            preferredFragmentPrecision: "highp",
            ...compileHighShaderGl({
                template: {vertex: vertexGlTemplate, fragment: fragmentGlTemplate},
                bits: [globalUniformsBitGl, localUniformBitGl, terrainBitGl(this.cellCount), roundPixelsBitGl],
            }),
        });
        this.gpuProgram = compileHighShaderGpuProgram({
            name: "terrain",
            bits: [localUniformBit, terrainBit(this.cellCount), roundPixelsBit],
        });
    }

    /**
     * @returns {boolean} whether any biome has ground art to draw
     */
    get hasArt() {
        return this.source !== null;
    }

    /**
     * The slot the tile draws through: its own biome's, or the transition art of the pair where the
     * blend beats the tile's dither threshold.
     * @param {number} biomeId
     * @param {number} otherId the biome the tile blends toward
     * @param {number} weight the tile's baked blend weight
     * @param {number} tileX world tile
     * @param {number} tileY world tile
     * @returns {number}
     */
    getSlotAt(biomeId, otherId, weight, tileX, tileY) {
        if (weight === 0) {
            return biomeId;
        }
        if (Math.min(1, weight * TRANSITION_SHARE_PER_UNIT) <= ditherThreshold(tileX, tileY)) {
            return biomeId;
        }
        if (this.transitionSlots[biomeId] !== NO_SLOT) {
            return this.transitionSlots[biomeId];
        }
        if (this.transitionSlots[otherId] !== NO_SLOT) {
            return this.transitionSlots[otherId];
        }
        return biomeId;
    }

    /**
     * @private
     * @param {number} slot
     * @param {string} biomeName for the error a bad frame raises
     * @param {string} frameName
     * @param {TextureCache} textureCache
     * @returns {void}
     */
    _addCell(slot, biomeName, frameName, textureCache) {
        const texture = textureCache.get(frameName);
        const source = texture.source;
        if (this.source === null) {
            this.source = source;
            this.texelSize[0] = 1 / source.width;
            this.texelSize[1] = 1 / source.height;
        } else if (this.source !== source) {
            throw new Error(`Biome "${biomeName}" draws from a second terrain sheet; ground art must share one`);
        }
        const frame = texture.frame;
        // The shader wraps in chunk-local pixels, which matches world pixels only while the cell's
        // period divides the chunk.
        if (CHUNK_PX % frame.width !== 0 || CHUNK_PX % frame.height !== 0) {
            throw new Error(`Biome "${biomeName}" ground art is ${frame.width}x${frame.height}px, which does not tile a ${CHUNK_PX}px chunk`);
        }
        const at = slot * CELL_FLOATS;
        this.uniforms[at] = frame.x / source.width;
        this.uniforms[at + 1] = frame.y / source.height;
        this.uniforms[at + 2] = frame.width;
        this.uniforms[at + 3] = frame.height;
    }
}

/**
 * The slot each of the chunk's tiles draws through, in the index texture's texel order.
 * @param {TerrainCellTable} cellTable
 * @param {number} chunkKey
 * @param {BiomeGrid} bake
 * @returns {Uint8Array}
 */
function groundSlots(cellTable, chunkKey, bake) {
    const origin = chunkOrigin(chunkKey);
    const slots = new Uint8Array(bake.biomes.length);
    for (let cell = 0; cell < slots.length; cell++) {
        const tileX = origin.x + cell % bake.cellsPerAxis;
        const tileY = origin.y + Math.floor(cell / bake.cellsPerAxis);
        if (bake.weights === null) {
            slots[cell] = bake.biomes[cell];
        } else {
            slots[cell] = cellTable.getSlotAt(bake.biomes[cell], bake.others[cell], bake.weights[cell], tileX, tileY);
        }
    }
    return slots;
}

/**
 * One chunk's ground art: a single quad over the chunk, textured off the chunk's baked biome ids.
 * Each tile's slot is uploaded as a one-texel-per-tile index texture the shader reads, so a chunk of
 * any biome mix costs one draw call and no per-tile geometry.
 */
export class TerrainMesh extends Mesh {

    /**
     * @param {TerrainCellTable} cellTable
     * @param {number} chunkKey
     * @param {BiomeGrid} bake the chunk's bake (Terrain.bakeChunk)
     */
    constructor(cellTable, chunkKey, bake) {
        const geometry = new Geometry({
            attributes: {
                aPosition: {
                    buffer: new Buffer({data: QUAD_POSITIONS, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST}),
                    format: "float32x2",
                    location: LOCATION_POSITION,
                },
                aUV: {
                    buffer: new Buffer({data: QUAD_UVS, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST}),
                    format: "float32x2",
                    location: LOCATION_UV,
                },
            },
            indexBuffer: new Buffer({data: QUAD_INDICES, usage: BufferUsage.INDEX | BufferUsage.COPY_DST}),
        });
        const indexSource = new BufferImageSource({
            resource: groundSlots(cellTable, chunkKey, bake),
            width: bake.cellsPerAxis,
            height: bake.cellsPerAxis,
            format: "r8unorm",
            scaleMode: "nearest",
        });
        super({
            geometry,
            shader: new Shader({
                glProgram: cellTable.glProgram,
                gpuProgram: cellTable.gpuProgram,
                resources: {
                    uTexture: cellTable.source,
                    uSampler: cellTable.source.style,
                    uIndexTexture: indexSource,
                    uIndexSampler: indexSource.style,
                    terrainUniforms: {
                        uCells: {type: "vec4<f32>", size: cellTable.cellCount, value: cellTable.uniforms},
                        uTexelSize: {type: "vec2<f32>", value: cellTable.texelSize},
                    },
                },
            }),
        });
        const origin = chunkOrigin(chunkKey);
        this.position.set(origin.x * TILE_SIZE, origin.y * TILE_SIZE);
        this._indexSource = indexSource;
    }

    /**
     * Frees the geometry, the index texture and the shader's bind groups with the mesh; the
     * programs belong to the cell table and are left alone.
     * @param {object|boolean} [options]
     * @returns {void}
     */
    destroy(options) {
        const shader = this.shader;
        const indexSource = this._indexSource;
        this.geometry.destroy(true);
        super.destroy(options);
        // The bind group holds the index texture until the shader lets go of it.
        shader.destroy();
        indexSource.destroy();
    }
}

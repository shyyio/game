// The engine surface a third-party mod's own tests run against, bundled into @spup/game-server:
// the real SDK plus the helpers the in-repo mods' specs use, from one module so a mod's classes and
// the engine's are the same instances (`instanceof` across the boundary has to hold).
//
// This is the only SDK a mod's tests see: real constants, real behaviors, a real Game — place the
// object, run ticks, assert on the result.

export * from "@/sdk/common.js";
export {ecsModRegistry, makeGameEngine, makeGame} from "@/test/ecsSim.js";
export {CapturingSession} from "@/test/CapturingSession.js";

<script setup>
import {onMounted} from "vue";
import {Application, Graphics, Container, FillGradient, isMobile} from "pixi.js";
import {ClientViewport} from "@/client/ClientViewport.js";
import Keyboard from "@/client/Keyboard.js";
import Mouse from "@/client/Mouse.js";
import {InputHandler} from "@/client/InputHandler.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {LogisticsClientMod} from "@/mods/Logistics/LogisticsClientMod.js";
import {DemoClientMod} from "@/mods/DemoMod/DemoMod.js";
import {ResourcesClientMod} from "@/mods/Resources/Resources.js";
import {BaseTexturesMod} from "@/mods/BaseTextures/mod.js";
import {Game} from "@/common/Game.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {ClientSaveStore} from "@/client/ClientSaveStore.js";
import {GameAPI} from "@/common/GameAPI.js";
import {LocalSession} from "@/common/LocalSession.js";
import {Client} from "@/client/Client.js";
import {TickPhase} from "@/common/core.js";
import {GAME_FONT} from "@/client/constants.js";

// Mobile mode (touch device): panning stays live while a tool is active so the
// player can aim the screen-center crosshair, hover/placement lock to center, and
// the pixi rotate button replaces the "r" key.
const mobile = isMobile.any;

// Selecting a tool zooms in to at least this scale (a no-op if already past it): on
// mobile, far enough that tiles are large enough to aim the center crosshair; on desktop,
// just past the map-mode threshold (0.25) so a tool is usable without leaving map mode far.
const TOOL_SELECT_ZOOM_MOBILE = 0.7;
const TOOL_SELECT_ZOOM_DESKTOP = 0.4;
const TOOL_SELECT_ZOOM_MS = 650;

const gameWidth = () => window.innerWidth;
const gameHeight = () => window.innerHeight + 64;

function createShadowOverlay(width, height) {
  const container = new Container();

  const leftGradient = new FillGradient({
    type: "linear",
    start: {x: 0, y: 0},
    end: {x: 1, y: 0},
    colorStops: [
      {offset: 0, color: "0x00000011"},
      {offset: 0.9, color: "0x00000000"},
    ],
  });

  const rightGradient = new FillGradient({
    type: "linear",
    start: {x: 0, y: 0},
    end: {x: 1, y: 0},
    colorStops: [
      {offset: 0.9, color: "0x00000000"},
      {offset: 1, color: "0x00000011"},
    ],
  });

  container.addChild(
      new Graphics()
          .rect(0, 0, width, height)
          .fill(leftGradient)
  );

  container.addChild(
      new Graphics()
          .rect(0, 0, width, height)
          .fill(rightGradient)
  );

  return container;
}

onMounted(async () => {

  const app = new Application();

  await app.init({
    background: "#f5f0e6",
    resolution: window.devicePixelRatio,
    resizeTo: window,
    autoDensity: true,
    roundPixels: true
  });

  // The whole game runs at a fixed 24fps, so one ticker tick is exactly one
  // animation frame (see animation.js).
  app.ticker.maxFPS = 24;

  // Load the game font before pixi rasterizes any text; a Text drawn before the face
  // is ready caches at the fallback and never re-rasterizes on its own.
  await document.fonts.load(`1em ${GAME_FONT}`);

  const viewport = new ClientViewport({
    screenWidth: gameWidth(),
    screenHeight: gameHeight(),
    worldWidth: gameWidth(),
    worldHeight: gameHeight(),
    events: app.renderer.events,
    threshold: 20,
  });

  app.stage.addChild(viewport);

  let overlay = createShadowOverlay(gameWidth(), gameHeight());
  app.stage.addChild(overlay);

  function handleResize() {
    viewport.resize(gameWidth(), gameHeight(), gameWidth(), gameHeight());

    app.stage.removeChild(overlay);
    overlay.destroy();
    overlay = createShadowOverlay(gameWidth(), gameHeight());
    app.stage.addChild(overlay);
  }

  window.addEventListener("resize", () => {
    handleResize();
  });

  viewport
      .drag()
      .wheel()
      .clampZoom({
        maxScale: 2,
        minScale: 0.05
      });

  if (isMobile.any) {
    viewport.pinch();
  }

  Mouse.init(app, viewport);

  document.getElementById("game").appendChild(app.canvas);

  const modRegistry = new ModRegistry();
  modRegistry.loadMod(new BaseTexturesMod());
  modRegistry.loadMod(new LogisticsClientMod());
  modRegistry.loadMod(new DemoClientMod());
  modRegistry.loadMod(new ResourcesClientMod());

  const game = new Game(modRegistry, new EcsSimEngine(modRegistry), new ClientSaveStore());
  await game.init();

  const api = new GameAPI(game);
  const session = new LocalSession(api);

  const client = new Client(app, viewport, session, modRegistry);
  session.client = client;
  game.connect(session);
  await client.init();

  const toolbar = client.toolbarLayer;

  const inputHandler = new InputHandler(modRegistry, toolbar);
  inputHandler.onMiniMenuEntryClick((tileX, tileY, screenX, screenY, onClose) => {
    const entries = modRegistry.miniMenuEntries(tileX, tileY, session, client);
    client.miniMenuLayer.open(entries, screenX, screenY, onClose);
  });
  inputHandler.onInspect((tileX, tileY) => {
    modRegistry.handleInspect(tileX, tileY, client);
  });
  inputHandler.init();

  client.rotateButtonsLayer.onRotate(() => inputHandler.rotateRight());

  // Map mode (zoomed far out) deactivates the active tool without clearing the toolbar
  // selection, so the cursor acts as if nothing were selected and the tool resumes on
  // zoom-in. The effective tool (null in map mode) drives the side effects below.
  let mapMode = false;

  // Applies the effective-tool side effects on both tool changes and map-mode toggles:
  // drop the current ghost/hover, toggle the rotate button, and freeze pan (desktop) or
  // enable center-lock (mobile) while a tool is active.
  const applyEffectiveTool = () => {
    const tool = mapMode ? null : toolbar.activeTool;
    inputHandler.clearToolPreview();
    inputHandler.clearInspect();
    inputHandler.refreshHover();
    client.rotateButtonsLayer.setVisible(tool != null && tool.orientable);
    if (mobile) {
      client.setCenterLock(tool != null && tool.usesCenterLock);
      return;
    }
    if (tool != null) {
      viewport.freezePan();
    } else {
      viewport.unfreezePan();
    }
  };

  // Selecting a toolbar tool zooms in. On desktop the zoom homes on the mouse cursor
  toolbar.onChange(() => {
    applyEffectiveTool();
    const target = mobile ? TOOL_SELECT_ZOOM_MOBILE : TOOL_SELECT_ZOOM_DESKTOP;
    if (toolbar.activeTool == null || viewport.scale.x >= target) {
      return;
    }
    const options = {
      scale: target,
      time: TOOL_SELECT_ZOOM_MS,
      ease: "easeOutCubic",
      removeOnInterrupt: true
    };
    if (!mobile && Mouse.currentX != null) {
      const ratio = viewport.scale.x / target;
      options.position = {
        x: Mouse.currentX - (Mouse.currentX - viewport.center.x) * ratio,
        y: Mouse.currentY - (Mouse.currentY - viewport.center.y) * ratio,
      };
    }
    viewport.animate(options);
  });

  const refreshTools = () => {
    toolbar.setTools(client.coreTools(), modRegistry.tools(client));
  };
  client.playerSettings.onChange(refreshTools);
  refreshTools();

  client.onMapModeChange((mode) => {
    inputHandler.setMapMode(mode);
    mapMode = mode;
    applyEffectiveTool();
  });

  function tick() {
    game.tick(TickPhase.SUBMIT_INTENTS);
    game.tick(TickPhase.RESOLVE_TRANSFERS);
    game.tick(TickPhase.CONSUME_INPUTS);
    game.tick(TickPhase.POST_RESOLVE);
    game.tick(TickPhase.PRODUCE_OUTPUTS);
    game.tick(TickPhase.COMMIT_TRANSFERS);
    game.tick(TickPhase.EMIT_RENDER);
    game.tick(TickPhase.EMIT_INSPECT);
    game.postTick();
  }

  // Debug keybindings (moved off the number keys, which now select tools).
  // Insert an item of value 1 onto the lowest-id belt path via its in-port.
  Keyboard.on("b", () => {
    game.simEngine.debugInsertItem();
  });

  Keyboard.on("t", () => {
    tick();
  });

  // Toggle debug mode
  Keyboard.on("d", () => {
    client.toggleDebugMode();
  });
});

</script>

<script>
import {defineComponent} from "vue";

export default defineComponent({
  name: "Game",
})

</script>

<template>
  <div id="game">
  </div>
</template>

<style scoped>
#game {
  position: absolute;
  overflow: hidden;
}
</style>

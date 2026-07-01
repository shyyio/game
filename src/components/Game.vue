<script setup>
import {reactive, markRaw, computed, ref, shallowRef, watch, onMounted} from "vue";
import {Application, Graphics, Container, FillGradient, isMobile} from "pixi.js";
import {ClientViewport} from "@/client/ClientViewport.js";
import Keyboard from "@/client/Keyboard.js";
import Mouse from "@/client/Mouse.js";
import {InputHandler} from "@/client/InputHandler.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {LogisticsClientMod} from "@/mods/Logistics/LogisticsClientMod.js";
import {DemoClientMod} from "@/mods/DemoMod/DemoMod.js";
import {BaseTexturesMod} from "@/mods/BaseTextures/mod.js";
import {DatabaseSchema} from "@/common/DatabaseSchema.js";
import {BrowserDatabase} from "@/client/BrowserDatabase.js";
import {Game} from "@/common/Game.js";
import {GameAPI} from "@/common/GameAPI.js";
import {LocalSession} from "@/common/LocalSession.js";
import {Client} from "@/client/Client.js";
import {TickPhase} from "@/common/core.js";
import {GAME_FONT} from "@/client/constants.js";

const toolbarState = reactive({activeTool: null, tools: []});
const viewportRef = shallowRef(null);
const inputHandlerRef = shallowRef(null);
const rotateButtonsRef = shallowRef(null);
const clientRef = shallowRef(null);

// Mobile mode (touch device): panning stays live while a tool is active so the
// player can aim the screen-center crosshair, hover/placement lock to center, and
// the pixi rotate button replaces the "r" key.
const mobile = isMobile.any;

// Map mode (zoomed far out) temporarily deactivates the active tool: the cursor acts
// as if nothing were selected while the toolbar keeps the tool highlighted, so
// zooming back in restores it. The side effects below key off this effective tool, so
// they fire on both tool changes and map-mode toggles.
const mapModeRef = ref(false);
const effectiveTool = computed(() => (mapModeRef.value ? null : toolbarState.activeTool));

watch(effectiveTool, (tool) => {
  if (inputHandlerRef.value != null) {
    inputHandlerRef.value.clearToolPreview();
    inputHandlerRef.value.clearInspect();
    inputHandlerRef.value.refreshHover();
  }
  // The rotate button is shown on both desktop and mobile while a tool is active.
  if (rotateButtonsRef.value != null) {
    rotateButtonsRef.value.setVisible(tool != null);
  }
  if (viewportRef.value == null) {
    return;
  }
  if (mobile) {
    if (clientRef.value != null) {
      clientRef.value.setCenterLock(tool != null);
    }
    return;
  }
  if (tool != null) {
    viewportRef.value.freezePan();
  } else {
    viewportRef.value.unfreezePan();
  }
});

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

  viewportRef.value = viewport;
  Mouse.init(app, viewport);

  document.getElementById("game").appendChild(app.canvas);

  const modRegistry = new ModRegistry();
  modRegistry.loadMod(new BaseTexturesMod());
  modRegistry.loadMod(new LogisticsClientMod());
  modRegistry.loadMod(new DemoClientMod());

  const schema = new DatabaseSchema(modRegistry);
  const db = new BrowserDatabase(schema);
  const game = new Game(modRegistry, db);
  await game.init();

  const api = new GameAPI(game);
  const session = new LocalSession(api);

  const client = new Client(app, viewport, session, modRegistry);
  clientRef.value = client;
  session.client = client;
  game.connect(session);
  await client.init();

  const refreshTools = () => {
    toolbarState.tools = modRegistry.tools(client).map(markRaw);
    if (!toolbarState.tools.includes(toolbarState.activeTool)) {
      toolbarState.activeTool = null;
    }
  };

  client.playerSettings.onChange(refreshTools);
  refreshTools();

  const inputHandler = new InputHandler(modRegistry, toolbarState);
  inputHandler.onMiniMenuEntryClick((tileX, tileY, screenX, screenY, onClose) => {
    const entries = modRegistry.miniMenuEntries(tileX, tileY, session, client);
    client.miniMenuLayer.open(entries, screenX, screenY, onClose);
  });
  inputHandler.onInspect((tileX, tileY) => {
    modRegistry.handleInspect(tileX, tileY, client);
  });
  inputHandler.init();
  inputHandlerRef.value = inputHandler;

  // Wire the pixi rotate button (shown while a tool is active, desktop or mobile).
  rotateButtonsRef.value = client.rotateButtonsLayer;
  client.rotateButtonsLayer.onRotate(() => inputHandler.rotateRight());

  // Map mode (zoomed far out): deactivate the active tool and disable tile hover via
  // the input handler, then flip the reactive flag so the effective-tool watcher
  // drops the ghost, hides the rotate buttons and releases the pan lock. The toolbar
  // selection is untouched, so the tool resumes on zoom-in.
  client.onMapModeChange((mapMode) => {
    inputHandler.setMapMode(mapMode);
    mapModeRef.value = mapMode;
  });

  function tick() {
    game.tick(TickPhase.SUBMIT_INTENTS);
    game.tick(TickPhase.RESOLVE_TRANSFERS);
    game.tick(TickPhase.CONSUME_INPUTS);
    game.tick(TickPhase.POST_RESOLVE);
    game.tick(TickPhase.PRODUCE_OUTPUTS);
    game.tick(TickPhase.COMMIT_TRANSFERS);
    game.tick(TickPhase.EMIT_RENDER);
    game.postTick();
  }

  // Debug keybindings (moved off the number keys, which now select tools).
  // Insert an item of value 1 onto the lowest-id belt path via its in-port.
  Keyboard.on("i", () => {
    db.rawExec("UPDATE Port SET item = 1 WHERE id = (SELECT in_port_id FROM BeltPath WHERE id = (SELECT MIN(id) FROM BeltPath))");
  });

  Keyboard.on("t", () => {
    tick();
  });

  // Toggle debug mode
  Keyboard.on("d", () => {
    client.toggleDebugMode();
  });

  window.dumpDatabase = () => {
    return db.dump();
  };
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
  <div class="toolbar">
    <button
        v-for="tool in toolbarState.tools"
        :key="tool.label"
        :class="{active: tool === toolbarState.activeTool}"
        @click="toolbarState.activeTool = (tool === toolbarState.activeTool ? null : tool)"
    >{{ tool.label }}
    </button>
  </div>
</template>

<style scoped>
#game {
  position: absolute;
  overflow: hidden;
}

.toolbar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  background: rgba(0, 0, 0, 0.6);
  padding: 8px 12px;
  border-radius: 8px;
}

.toolbar button {
  font-family: "Lexend", sans-serif;
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  cursor: pointer;
  font-size: 13px;
}

.toolbar button.active {
  background: rgba(255, 255, 255, 0.25);
  border-color: #5bf;
  box-shadow: inset 0 -3px 0 #5bf;
  color: #fff;
}
</style>

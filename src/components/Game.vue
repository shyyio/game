<script setup>
import {ref, reactive, markRaw, shallowRef, watch, onMounted} from "vue";
import {Application, Graphics, Container, FillGradient, isMobile} from "pixi.js";
import {ClientViewport} from "@/client/ClientViewport.js";
import Keyboard from "@/client/keyboard.js";
import Mouse from "@/client/Mouse.js";
import {InputHandler} from "@/client/InputHandler.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {BeltClientMod} from "@/mods/Belt/BeltClientMod.js";
import {SplitterClientMod} from "@/mods/Splitter/SplitterClientMod.js";
import {BaseTexturesMod} from "@/mods/BaseTextures/mod.js";
import {DatabaseSchema} from "@/common/DatabaseSchema.js";
import {BrowserDatabase} from "@/client/BrowserDatabase.js";
import {Game} from "@/common/Game.js";
import {GameAPI} from "@/common/GameAPI.js";
import {LocalSession} from "@/common/LocalSession.js";
import {Client} from "@/client/Client.js";
import {TickPhase} from "@/common/core.js";
import {TILE_SIZE} from "@/client/constants.js";

const tools = ref([]);
const toolbarState = reactive({activeTool: null});
const viewportRef = shallowRef(null);
const inputHandlerRef = shallowRef(null);

watch(() => toolbarState.activeTool, (tool) => {
  if (inputHandlerRef.value != null) {
    inputHandlerRef.value.clearToolPreview();
  }
  if (viewportRef.value == null) {
    return;
  }
  if (tool != null) {
    viewportRef.value.freezePan();
  } else {
    viewportRef.value.unfreezePan();
  }
});

const gameWidth = () => window.innerWidth - Number(document.getElementById("game").style.left.replace("px", ""));
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
    background: "white",
    resolution: window.devicePixelRatio,
    resizeTo: window,
    autoDensity: true,
    roundPixels: true
  });

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

  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutationRecord) {
      handleResize();
    });
  });

  observer.observe(document.getElementById("game"), {attributes: true, attributeFilter: ["style"]});

  viewport
      .drag()
      .wheel()
      .clampZoom({
        maxScale: 2,
        minScale: 0.05
      });

  if (isMobile.any) {
    viewport.pinch().decelerate();
  }

  viewportRef.value = viewport;
  Mouse.init(app, viewport);

  document.getElementById("game").appendChild(app.canvas);

  const modRegistry = new ModRegistry();
  modRegistry.loadMod(new BaseTexturesMod());
  modRegistry.loadMod(new BeltClientMod());
  modRegistry.loadMod(new SplitterClientMod());

  const schema = new DatabaseSchema(modRegistry);
  const db = new BrowserDatabase(schema);
  const game = new Game(modRegistry, db);
  await game.init();

  const api = new GameAPI(game);
  const session = new LocalSession(api);

  const client = new Client(app, viewport, session, modRegistry);
  session.client = client;
  game.connect(session);
  await client.init();

  const refreshTools = () => {
    tools.value = modRegistry.tools(session, client.playerSettings).map(markRaw);
    if (!tools.value.includes(toolbarState.activeTool)) {
      toolbarState.activeTool = null;
    }
  };

  client.playerSettings.onChange(refreshTools);
  refreshTools();

  const inputHandler = new InputHandler(modRegistry, toolbarState);
  inputHandler.onMiniMenuEntryClick((tileX, tileY, screenX, screenY) => {
    const entries = modRegistry.miniMenuContextEntries(tileX, tileY, session);
    client.miniMenuLayer.open(entries, screenX, screenY);
  });
  inputHandler.onDirectionWheel((tileX, tileY, onSelect) => {
    const screen = viewport.toScreen(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + TILE_SIZE / 2);
    client.directionWheelLayer.open(screen.x, screen.y, onSelect);
  });
  inputHandler.init();
  inputHandlerRef.value = inputHandler;

  // Map mode (zoomed far out): disable tile hover and drop any active tool's
  // ghost preview, since no onTileExit fires once hover is off.
  client.onMapModeChange((mapMode) => {
    Mouse.setHoverEnabled(!mapMode);
    if (mapMode) {
      inputHandler.clearToolPreview();
    }
  });

  function tick() {
    game.tick(TickPhase.SUBMIT_INTENTS);
    game.tick(TickPhase.RESOLVE_TRANSFERS);
    game.tick(TickPhase.POST_RESOLVE);
    game.tick(TickPhase.COMMIT_TRANSFERS);
    game.postTick();
  }

  // Debug keybindings.
  Keyboard.on("1", () => {
    db.rawExec("UPDATE Port SET item = 1 WHERE id = 0");
  });

  Keyboard.on("2", () => {
    tick();
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
  <div id="game" :style="{left: $store.state.canvasLeft + 'px'}">
  </div>
  <div class="toolbar">
    <button
        v-for="tool in tools"
        :key="tool.label"
        :class="{active: tool === toolbarState.activeTool}"
        @click="toolbarState.activeTool = (tool === toolbarState.activeTool ? null : tool)"
    >{{ tool.label }}</button>
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

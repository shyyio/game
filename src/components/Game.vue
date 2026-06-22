<script setup>
import {ref, reactive, markRaw, shallowRef, watch, onMounted} from "vue";
import {Application, Graphics, Container, FillGradient, isMobile} from "pixi.js";
import {Viewport} from "pixi-viewport";
import {freezeViewport, unfreezeViewport} from "@/client/viewport.js";
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

const tools = ref([]);
const toolbarState = reactive({activeTool: null});
const viewportRef = shallowRef(null);

watch(() => toolbarState.activeTool, (tool) => {
  if (viewportRef.value == null) {
    return;
  }
  if (tool != null) {
    freezeViewport(viewportRef.value);
  } else {
    unfreezeViewport(viewportRef.value);
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

  const viewport = new Viewport({
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
        // TODO: when zooming out too much, switch to a simplified grid view (?)
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
      toolbarState.activeTool = tools.value.length > 0 ? tools.value[0] : null;
    }
  };

  client.playerSettings.onChange(refreshTools);
  refreshTools();

  const inputHandler = new InputHandler(modRegistry, toolbarState);
  inputHandler.onMiniMenuEntryClick((tileX, tileY, screenX, screenY) => {
    const entries = modRegistry.miniMenuContextEntries(tileX, tileY, session);
    client.miniMenuLayer.open(entries, screenX, screenY);
  });
  inputHandler.init();

  function tick() {
    game.tick(TickPhase.SUBMIT_INTENTS);
    game.tick(TickPhase.RESOLVE_TRANSFERS);
    game.tick(TickPhase.POST_RESOLVE);
    game.tick(TickPhase.COMMIT_TRANSFERS);
    game.postTick();
  }

  Keyboard.on("t", () => {
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

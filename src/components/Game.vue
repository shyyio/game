<script setup>
import {computed, onMounted, onUnmounted, ref, shallowRef} from "vue";
import {useTheme} from "vuetify";
import {createPixiApp} from "@/client/PixiApp.js";
import {createClient} from "@/client/GameBootstrap.js";
import {EffectiveToolController} from "@/client/input/EffectiveToolController.js";
import {bindGameKeyboardShortcuts} from "@/client/input/GameKeyboardShortcuts.js";
import {useSettingsMenu} from "@/composables/useSettingsMenu.js";
import Mobile from "@/client/Mobile.js";
import ReducedMotion from "@/client/ReducedMotion.js";
import DeviceSettings, {
  DEVICE_SETTING_MOBILE,
  DEVICE_SETTING_REDUCED_MOTION,
  DEVICE_SETTING_THEME,
} from "@/client/state/DeviceSettings.js";
import {PlayerSettingChoice} from "@/client/hud/PlayerSettingChoice.js";
import {DeviceSettingChoice} from "@/client/hud/DeviceSettingChoice.js";
import {DeviceSettingSlider} from "@/client/hud/DeviceSettingSlider.js";
import {applyTheme, onThemeChange, THEME_DEFAULT} from "@/client/Theme.js";
import {vuetifyThemeName} from "@/client/vuetifyTheme.js";
import {gameStart, startError, GAME_MODE_REMOTE} from "@/client/GameStart.js";
import {useRouter} from "vue-router";
import TerrainTuner from "@/components/TerrainTuner.vue";

const router = useRouter();
const settingsOpen = ref(false);
// Temporary terrain-tuning dialog; shallow so the client never becomes a reactive proxy.
const terrainOpen = ref(false);
const terrainClient = shallowRef(null);

const {settingsCategories, settingValues, bindSettingsMenu} = useSettingsMenu();

Mobile.setEnabled(DeviceSettings.getBoolean(DEVICE_SETTING_MOBILE, Mobile.devicePrefers()));
// Before the dialog can open, so its first open honors the preference.
ReducedMotion.setEnabled(DeviceSettings.getBoolean(DEVICE_SETTING_REDUCED_MOTION, ReducedMotion.devicePrefers()));
const reducedMotion = ref(ReducedMotion.enabled);
const stopMotionSync = ReducedMotion.onChange(on => reducedMotion.value = on);

// A false transition drops the dialog's slide; the scrim fade goes with the root class.
const dialogTransition = computed(() => {
  if (reducedMotion.value) {
    return false;
  }
  return "dialog-bottom-transition";
});
// The sprite editor is its own chunk, fetched on first open, and runs in its own window.
let spriteEditorSession = null;
let spriteEditorModule = null;
let closeSpriteEditorWindow = null;
let editorClient = null;

async function openSpriteEditor() {
  if (editorClient === null || closeSpriteEditorWindow !== null) {
    return;
  }
  if (spriteEditorModule === null) {
    spriteEditorModule = await import("@/client/spriteEditor/spriteEditor.js");
  }
  if (spriteEditorSession === null) {
    spriteEditorSession = new spriteEditorModule.SpriteEditorSession(editorClient.textureRegistry, editorClient.spriteOverrideStore);
  }
  try {
    closeSpriteEditorWindow = spriteEditorModule.openSpriteEditorWindow(spriteEditorSession, () => {
      closeSpriteEditorWindow = null;
    });
  } catch (error) {
    window.alert(error.message);
  }
}

function closeSpriteEditor() {
  if (closeSpriteEditorWindow !== null) {
    const close = closeSpriteEditorWindow;
    closeSpriteEditorWindow = null;
    close();
  }
}

function toggleSpriteEditor() {
  if (closeSpriteEditorWindow !== null) {
    closeSpriteEditor();
  } else {
    openSpriteEditor();
  }
}

/**
 * What went wrong, in a form the screen we bounce to can show. Mod code throws whatever it likes, so
 * a bare `.message` is not enough: an object with none leaves the player staring at a blank line.
 * @param {*} error whatever was thrown
 * @returns {string}
 */
function reasonOf(error) {
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }
  const text = `${error}`;
  if (text !== "") {
    return text;
  }
  return "no reason given, see the browser console";
}

// Before the HUD builds, so the first paint is in the chosen palette.
applyTheme(DeviceSettings.getNumber(DEVICE_SETTING_THEME, THEME_DEFAULT));

// The menus are Vuetify, not pixi: same setting, their own theme.
const vuetifyTheme = useTheme();
const stopThemeSync = onThemeChange(themeId => {
  vuetifyTheme.change(vuetifyThemeName(themeId));
});

// Set once setup finishes; onUnmounted may fire mid-setup (a fast back-navigation), so each
// await below checks `disposed` and unwinds whatever it already built instead of racing ahead.
let disposed = false;
let teardown = () => {};

onMounted(async () => {
  const pixiApp = await createPixiApp();
  if (disposed) {
    pixiApp.destroy();
    return;
  }
  const {app, viewport, syncMobileTouchInput, destroy: destroyPixiApp} = pixiApp;

  // A failed start (unreachable server, mods that will not load) goes back with the reason instead
  // of leaving an empty canvas mounted: to the server list for a join, and to the mods screen for a
  // local game, since that is where its loadout was chosen and where it can be fixed. A mod can
  // throw anything at all, so the reason has to survive a throw that is not an Error.
  let bootstrap;
  try {
    bootstrap = await createClient(app, viewport, gameStart.value);
  } catch (error) {
    destroyPixiApp();
    // The stack is worth having in the console; the screen we bounce to only gets the message.
    console.error(error);
    startError.value = reasonOf(error);
    if (gameStart.value.mode === GAME_MODE_REMOTE) {
      router.push({name: "servers"});
    } else {
      router.push({name: "mods"});
    }
    return;
  }
  if (disposed) {
    bootstrap.inputHandler.destroy();
    bootstrap.destroy();
    destroyPixiApp();
    return;
  }
  const {client, game, inputHandler, destroy: destroyClient} = bootstrap;

  const toolController = new EffectiveToolController(client, viewport, client.toolbarLayer, inputHandler);
  toolController.init();

  // Installs/tears down touch input and recomputes center-lock/pan-freeze when the
  // "Touchscreen input" toggle flips mid-session.
  const unsubMobile = Mobile.onChange(() => {
    syncMobileTouchInput();
    toolController.applyEffectiveTool();
    client.versionWatermarkLayer.refresh();
  });

  bindSettingsMenu(client);
  client.settingsButtonLayer.onPress(() => settingsOpen.value = true);
  client.artButtonLayer.onPress(toggleSpriteEditor);
  client.terrainButtonLayer.onPress(() => terrainOpen.value = true);
  terrainClient.value = client;

  editorClient = client;
  const unbindKeyboard = bindGameKeyboardShortcuts(client, game, client.toolbarLayer);

  teardown = () => {
    terrainOpen.value = false;
    terrainClient.value = null;
    closeSpriteEditor();
    if (spriteEditorSession !== null) {
      spriteEditorSession.destroy();
      spriteEditorSession = null;
    }
    editorClient = null;
    unbindKeyboard();
    inputHandler.destroy();
    unsubMobile();
    destroyClient();
    destroyPixiApp();
  };
});

onUnmounted(() => {
  disposed = true;
  stopMotionSync();
  stopThemeSync();
  teardown();
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
  <v-dialog v-model="settingsOpen" max-width="480" content-class="settings-dialog" :transition="dialogTransition">
    <v-card>
      <v-toolbar title="Settings">
        <v-btn variant="text" @click="settingsOpen = false">Close</v-btn>
      </v-toolbar>
      <v-card-text>
        <div class="settings-list">
          <template v-for="category in settingsCategories" :key="category.name">
            <div class="settings-category-title">{{ category.name }}</div>
            <template v-for="control in category.controls" :key="control.key">
              <v-select
                  v-if="control instanceof PlayerSettingChoice || control instanceof DeviceSettingChoice"
                  v-model="settingValues[control.key]"
                  :label="control.label"
                  :items="control.items"
                  variant="solo"
                  density="compact"
                  hide-details
              />
              <v-slider
                  v-else-if="control instanceof DeviceSettingSlider"
                  v-model="settingValues[control.key]"
                  :label="control.label"
                  :min="control.min"
                  :max="control.max"
                  :step="control.step"
                  thumb-label
                  color="primary"
                  density="compact"
                  hide-details
              />
              <v-switch
                  v-else
                  v-model="settingValues[control.key]"
                  :label="control.label"
                  color="primary"
                  density="compact"
                  hide-details
              />
            </template>
          </template>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
  <TerrainTuner v-model="terrainOpen" :client="terrainClient" />
</template>

<style scoped>
#game {
  position: absolute;
  overflow: hidden;
}
</style>

<!-- Unscoped: the dialog content is teleported outside this component. -->
<style>
/* The scrim fade is Vuetify's own, not the `transition` prop's; its duration is !important. */
.reduced-motion .v-overlay__scrim {
  transition-duration: 0s !important;
}

.v-dialog > .settings-dialog {
  margin: max(env(safe-area-inset-top, 0px), 24px)
          max(env(safe-area-inset-right, 0px), 24px)
          max(env(safe-area-inset-bottom, 0px), 24px)
          max(env(safe-area-inset-left, 0px), 24px);
}

.settings-dialog .settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-dialog .settings-category-title {
  font-size: 0.875rem;
  font-weight: 500;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.settings-dialog .settings-category-title:not(:first-child) {
  margin-top: 8px;
}
</style>

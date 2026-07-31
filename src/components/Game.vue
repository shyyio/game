<script setup>
import {onMounted, ref} from "vue";
import {createPixiApp} from "@/client/PixiApp.js";
import {createClient} from "@/client/GameBootstrap.js";
import {EffectiveToolController} from "@/client/EffectiveToolController.js";
import {bindGameKeyboardShortcuts} from "@/client/GameKeyboardShortcuts.js";
import {useSettingsMenu} from "@/composables/useSettingsMenu.js";
import Mobile from "@/client/Mobile.js";
import DeviceSettings, {DEVICE_SETTING_MOBILE} from "@/client/DeviceSettings.js";
import {PlayerSettingChoice} from "@/client/PlayerSettingChoice.js";

const props = defineProps({
  mode: {type: String, default: "local"},
  username: {type: String, default: ""},
  serverUrl: {type: String, default: ""},
});

const settingsOpen = ref(false);

const {settingsCategories, settingValues, bindSettingsMenu} = useSettingsMenu();

Mobile.setEnabled(DeviceSettings.getBoolean(DEVICE_SETTING_MOBILE, Mobile.devicePrefers()));

onMounted(async () => {
  const {app, viewport, syncMobileTouchInput} = await createPixiApp();
  const {client, game, inputHandler} = await createClient(app, viewport, props);

  const toolController = new EffectiveToolController(client, viewport, client.toolbarLayer, inputHandler);
  toolController.init();

  // Installs/tears down touch input and recomputes center-lock/pan-freeze when the
  // "Touchscreen input" toggle flips mid-session.
  Mobile.onChange(() => {
    syncMobileTouchInput();
    toolController.applyEffectiveTool();
  });

  bindSettingsMenu(client);
  client.settingsButtonLayer.onPress(() => settingsOpen.value = true);

  bindGameKeyboardShortcuts(client, game, client.toolbarLayer);
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
  <v-dialog v-model="settingsOpen" max-width="480" content-class="settings-dialog" transition="dialog-bottom-transition">
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
                  v-if="control instanceof PlayerSettingChoice"
                  v-model="settingValues[control.key]"
                  :label="control.label"
                  :items="control.items"
                  variant="solo"
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
</template>

<style scoped>
#game {
  position: absolute;
  overflow: hidden;
}
</style>

<!-- Unscoped: the dialog content is teleported outside this component. -->
<style>
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

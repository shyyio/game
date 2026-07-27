<script setup>
import {ref} from "vue";
import {USERNAME_PATTERN} from "@/common/constants.js";

const STORAGE_USERNAME = "shys-power-up-factory.username";
const STORAGE_SERVER_URL = "shys-power-up-factory.serverUrl";
const DEFAULT_SERVER_URL = "ws://localhost:8080";

const emit = defineEmits(["start"]);

const username = ref(localStorage.getItem(STORAGE_USERNAME) || "");
const serverUrl = ref(localStorage.getItem(STORAGE_SERVER_URL) || DEFAULT_SERVER_URL);

const usernameRules = [
  value => USERNAME_PATTERN.test(value) || "3-20 letters, digits, or _",
];

function usernameValid() {
  return USERNAME_PATTERN.test(username.value);
}

function playLocal() {
  emit("start", {mode: "local", username: username.value, serverUrl: serverUrl.value});
}

function connect() {
  if (!usernameValid()) {
    return;
  }
  localStorage.setItem(STORAGE_USERNAME, username.value);
  localStorage.setItem(STORAGE_SERVER_URL, serverUrl.value);
  emit("start", {mode: "remote", username: username.value, serverUrl: serverUrl.value});
}
</script>

<template>
  <div class="sign-in">
    <v-card class="sign-in-card" elevation="8">
      <v-card-title>Shy's Power-Up Factory</v-card-title>
      <v-card-text>
        <v-text-field
            v-model="username"
            label="Username"
            :rules="usernameRules"
            autofocus
            @keyup.enter="connect"
        />
        <v-text-field
            v-model="serverUrl"
            label="Server"
        />
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="playLocal">Play local</v-btn>
        <v-spacer/>
        <v-btn color="primary" variant="flat" :disabled="!usernameValid()" @click="connect">Connect</v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

<style scoped>
.sign-in {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f0e6;
}

.sign-in-card {
  width: min(90vw, 360px);
}
</style>

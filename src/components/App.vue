<script setup>
import {ref} from "vue";
import Game from "@/components/Game.vue";
import SignIn from "@/components/SignIn.vue";
import {SCENARIO_PARAM} from "@/test/scenarios/index.js";

const hasScenario = new URLSearchParams(window.location.search).has(SCENARIO_PARAM);
const start = ref(hasScenario ? {mode: "local", username: "", serverUrl: ""} : null);

function onStart(options) {
  start.value = options;
}
</script>

<template>
  <SignIn v-if="start === null" @start="onStart"/>
  <Game v-else :mode="start.mode" :username="start.username" :server-url="start.serverUrl"/>
</template>

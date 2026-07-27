<script setup>
import {ref} from "vue";
import Game from "@/components/Game.vue";
import SignIn from "@/components/SignIn.vue";

const start = ref(null);

function onStart(options) {
  start.value = options;
}
</script>

<template>
  <SignIn v-if="start === null" @start="onStart"/>
  <Game v-else :mode="start.mode" :username="start.username" :server-url="start.serverUrl"/>
</template>

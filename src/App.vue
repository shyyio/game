<script>

import {defineComponent} from "vue";
import Game from "@/components/Game.vue";
import NodePicker from "@/components/NodePicker.vue";
import LeftDrawer from "@/components/LeftDrawer.vue";
import BottomDrawer from "@/components/BottomDrawer.vue";

export default defineComponent({
  components: {BottomDrawer, NodePicker, Game, LeftDrawer},
  data() {
    return {
      leftDrawer: false,
      currentBottomMenu: null,
      pinLeftDrawer: false,
      bottomDrawer: false
    }
  },
  mounted() {
    this.leftDrawer = !this.$vuetify.display.mobile;
  },
  methods: {
    onMenuChange(event) {

      this.bottomDrawer = false;

      if (event.id === "nodes") {
        this.bottomDrawer = event.value;
      }
    }
  },
})

</script>

<template>
  <v-layout>

    <LeftDrawer>

      <v-list density="compact" nav v-model="currentBottomMenu" @click:select="onMenuChange($event)">
        <v-list-item prepend-icon="mdi-vector-square" title="Nodes" value="nodes"></v-list-item>
      </v-list>

    </LeftDrawer>

    <BottomDrawer :show="bottomDrawer">
      <NodePicker></NodePicker>
    </BottomDrawer>

    <div class="game-wrapper">
      <Game :left="$store.state.canvasLeft"/>
    </div>

  </v-layout>

</template>

<style scoped>
</style>

<script>
import {defineComponent} from 'vue'
import NodePicker from "@/components/NodePicker.vue";

export default defineComponent({
  name: "BottomDrawer",
  components: {NodePicker},
  props: ["show"]
})
</script>

<template>
  <v-navigation-drawer
      v-model="show"
      location="bottom"
      permanent
  >
    <slot></slot>
  </v-navigation-drawer>
</template>

<style scoped>

</style>
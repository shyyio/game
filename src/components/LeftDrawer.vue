<script>
import {defineComponent} from "vue";

export default defineComponent({
  name: "LeftDrawer",
  data() {
    return {
      show: false,
      pinned: false
    }
  },
  methods: {
    updateLeft() {
       if (this.$vuetify.display.mobile) {
         this.$store.commit("setCanvasLeft", 0);
       } else {
         if (this.pinned) {
           this.$store.commit("setCanvasLeft", 256);
         } else {
           this.$store.commit("setCanvasLeft", 56);
         }
       }
    }
  },
  mounted() {
    this.updateLeft();
  },
  computed: {
    mobileWidth() {
      return window.innerWidth - 35;
    }
  }
});
</script>

<template>
  <template v-if="$vuetify.display.mobile">
    <v-fab icon="mdi-menu" v-show="!show" style="z-index: 999; height: 75px; left: 10px"
           @click="show = true"></v-fab>

    <v-navigation-drawer
        v-model="show"
        :width="mobileWidth"
    >
      <v-list>
        <v-list-item
            prepend-avatar="https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:mp2sfyr5zkmwdgen3e2twiov/bafkreid7rhlfevkiywb2wxr7qldrd4qleax6ixlydqdzhsfzoqfbvaxi3q@jpeg"
            subtitle="shyy.io"
            title="Shy"
        >
          <template v-slot:append>
            <v-btn
                icon="mdi-chevron-left"
                variant="text"
                @click.stop="show = false"
            ></v-btn>
          </template>
        </v-list-item>
      </v-list>

      <v-divider></v-divider>

      <slot></slot>
    </v-navigation-drawer>
  </template>
  <template v-else>
    <v-navigation-drawer
        permanent
        :rail="!pinned"
        :expand-on-hover="!pinned"
    >
      <v-list>
        <v-list-item
            prepend-avatar="https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:mp2sfyr5zkmwdgen3e2twiov/bafkreid7rhlfevkiywb2wxr7qldrd4qleax6ixlydqdzhsfzoqfbvaxi3q@jpeg"
            subtitle="shyy.io"
            title="Shy"
        >
          <template v-slot:append>
            <v-btn
                :icon="pinned ? 'mdi-chevron-left' : 'mdi-pin'"
                variant="text"
                @click.stop="pinned = !pinned; updateLeft()"
            ></v-btn>
          </template>
        </v-list-item>
      </v-list>

      <v-divider></v-divider>
      <slot></slot>
    </v-navigation-drawer>

  </template>
</template>

<style scoped>

</style>
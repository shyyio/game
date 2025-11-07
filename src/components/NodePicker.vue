<script setup>

</script>

<template>
  <v-layout style="height: 100%">
    <v-navigation-drawer
        permanent
        touchless
        :rail="$vuetify.display.mobile"
    >
      <v-list density="compact" nav>
        <v-list-item
            prepend-icon="mdi-star"
            title="Basic"
            value="basic"
        ></v-list-item>
        <v-list-item
            prepend-icon="mdi-export-variant"
            title="Extraction"
            value="extraction"
        ></v-list-item>
        <v-list-item
            prepend-icon="mdi-factory"
            title="Chemical"
            value="chemical"
        ></v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <div class="node-picker-container">
        <v-card v-for="i in [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]" class="node-card">
          <v-card-title>test</v-card-title>
          <v-card-text>hello</v-card-text>
        </v-card>
      </div>
    </v-main>
  </v-layout>
</template>

<style scoped>
.node-picker-container {
  display: grid;
  gap: 10px;

  padding: 10px;
  flex-wrap: wrap;
  justify-content: space-around;
  grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr;

  max-height: 100%;
  overflow-y: scroll;
}

@media (max-width: 1600px) {
  .node-picker-container {
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
  }
}

@media (max-width: 1250px) {
  .node-picker-container {
    grid-template-columns: 1fr 1fr 1fr 1fr;
  }
}

@media (max-width: 950px) {
  .node-picker-container {
    grid-template-columns: 1fr 1fr 1fr;
  }
}

@media (max-width: 750px) {
  .node-picker-container {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 650px) {
  .node-picker-container {
    grid-template-columns: 1fr;
  }
}

.node-card {
}
</style>
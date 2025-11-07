import { createStore } from 'vuex';

const store = createStore({
  state () {
    return {
      canvasLeft: 0,
    }
  },
  mutations: {
    setCanvasLeft: (state, value) => state.canvasLeft = value
  }
});

export default store;
'use strict';

// The app's asynchronous startup renders the Start screen after the v81
// overrides are installed. Re-render once startup data is ready so the fixed
// rolling two-week preview is used on the first paint as well as later visits.
(() => {
  const originalLoadDataAndShowApp = loadDataAndShowApp;
  loadDataAndShowApp = async function loadDataAndShowAppV81() {
    const result = await originalLoadDataAndShowApp();
    if (currentScreen === 'main' && currentTab === 'myconcerts') {
      renderMyConcertsScreen();
    }
    return result;
  };
})();

(() => {
  const MAX_BOOT_FRAMES = 120;

  function readSceneConfig() {
    return window.IMS_CODEPEN_SCENE_CONFIG || null;
  }

  function boot(remainingFrames) {
    const runtime = window.ImsGrowthCalculator;
    if (!runtime) {
      if (remainingFrames <= 0) {
        return;
      }
      window.requestAnimationFrame(() => {
        boot(remainingFrames - 1);
      });
      return;
    }

    const config = readSceneConfig();
    if (config) {
      runtime.initScene(config);
      return;
    }

    runtime.autoInitScene();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot(MAX_BOOT_FRAMES);
    });
    return;
  }

  boot(MAX_BOOT_FRAMES);
})();

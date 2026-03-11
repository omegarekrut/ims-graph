(() => {
  const MAX_BOOT_FRAMES = 120;

  function boot(remainingFrames) {
    const runtime = window.ImsGrowthCalculator;
    if (runtime) {
      runtime.autoInit();
      return;
    }
    if (remainingFrames <= 0) {
      return;
    }
    window.requestAnimationFrame(() => {
      boot(remainingFrames - 1);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot(MAX_BOOT_FRAMES);
    });
    return;
  }

  boot(MAX_BOOT_FRAMES);
})();

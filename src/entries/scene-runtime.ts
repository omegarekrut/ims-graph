export {
  autoInitEmbed,
  autoInitScene,
  autoInitSceneEmbed,
  initEmbed,
  initScene,
  initSceneEmbed,
  loadLegacyRuntime,
  publicApi,
  setRuntimeLegacyApi
} from './embed';

export {
  installBrowserRuntime
} from './bootstrap-browser';

import { installBrowserRuntime } from './bootstrap-browser';

installBrowserRuntime();

export { installBrowserRuntime } from './bootstrap-browser';
export {
  autoInitEmbed,
  autoInitScene,
  autoInitSceneEmbed,
  initEmbed,
  initScene,
  initSceneEmbed,
  loadLegacyRuntime,
  publicApi,
  setRuntimeLegacyApi,
} from './embed';

import { installBrowserRuntime } from './bootstrap-browser';

installBrowserRuntime();

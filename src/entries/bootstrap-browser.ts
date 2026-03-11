import type { ImsGrowthCalculatorPublicApi } from '../core/contracts';
import { getLegacyApi } from '../widgets/legacy/legacy-api';
import { autoInitEmbed, publicApi, setRuntimeLegacyApi } from './embed';

export interface BrowserBootstrapOptions {
  autoInit?: boolean;
  force?: boolean;
}

type RuntimeWindow = Window & {
  __IMS_GRAPH_RUNTIME_BOOTSTRAPPED__?: boolean;
  ImsGrowthCalculator?: ImsGrowthCalculatorPublicApi;
};

function scheduleAutoInit(): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      autoInitEmbed();
    });
    return;
  }

  autoInitEmbed();
}

export function installBrowserRuntime(
  options: BrowserBootstrapOptions = {}
): ImsGrowthCalculatorPublicApi {
  if (typeof window === 'undefined') {
    return publicApi;
  }
  const runtimeWindow = window as RuntimeWindow;

  const shouldForce = options.force === true;
  if (!shouldForce && runtimeWindow.__IMS_GRAPH_RUNTIME_BOOTSTRAPPED__) {
    return publicApi;
  }

  setRuntimeLegacyApi(getLegacyApi());
  runtimeWindow.ImsGrowthCalculator = publicApi;
  runtimeWindow.__IMS_GRAPH_RUNTIME_BOOTSTRAPPED__ = true;

  const shouldAutoInit = options.autoInit !== false;
  if (shouldAutoInit) {
    scheduleAutoInit();
  }

  return publicApi;
}

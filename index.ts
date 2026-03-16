import { ExecStreamHook } from './src/hook';
import { ExecStreamServer } from './src/server';
import type { PluginConfig, ResolvedPluginConfig } from './src/types';

function resolveConfig(config: PluginConfig = {}): ResolvedPluginConfig {
  return {
    ...config,
    mode: config.mode === 'remote' ? 'remote' : 'local'
  };
}

export default {
  id: 'exec-stream',
  name: 'Exec Stream',

  register(api) {
    const rawConfig = api.config?.plugins?.entries?.['exec-stream']?.config || {};
    const config = resolveConfig(rawConfig);

    ExecStreamHook.register(api, config);

    if (config.mode === 'local') {
      ExecStreamServer.register(api, config);
      api.logger.info(`[exec-stream] Plugin loaded in local mode (port=${config.port || 9200})`);
      return;
    }

    api.logger.info('[exec-stream] Plugin loaded in remote mode (local server disabled, port ignored)');
  }
};

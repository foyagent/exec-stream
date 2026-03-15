import { ExecStreamHook } from './src/hook';
import { ExecStreamServer } from './src/server';

export default {
  id: 'exec-stream',
  name: 'Exec Stream',

  register(api) {
    const config = api.config?.plugins?.entries?.['exec-stream']?.config || {};

    ExecStreamHook.register(api);
    ExecStreamServer.register(api, config);

    api.logger.info('Exec Stream plugin loaded');
  }
};

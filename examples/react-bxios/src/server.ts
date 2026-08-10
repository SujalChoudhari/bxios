import { MultiplexedStreamingEngine, WSServerDriver } from '@bxios/server';

export async function startExampleServer() {
  const driver = new WSServerDriver();
  await driver.listen(0, '127.0.0.1');
  new MultiplexedStreamingEngine(driver, {
    handler: async () => (async function* () { yield 'connected'; })(),
  });
  return driver;
}

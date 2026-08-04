import { IServerDriver, ServerDriverOptions } from './types.js';
import { UWSServerDriver, isUWSAvailable } from './uwsDriver.js';
import { WSServerDriver } from './wsDriver.js';

export type DriverKind = 'uws' | 'ws' | 'auto';

/**
 * Creates a server-side WebSocket driver instance.
 *
 * Auto-detection mode ('auto' or default):
 * Attempts to load `uWebSockets.js` (native C++ high-performance binding).
 * If available, returns `UWSServerDriver`.
 * Otherwise, falls back gracefully to `WSServerDriver` (pure Node.js `ws` module).
 *
 * @param kind - 'uws' | 'ws' | 'auto' (default: 'auto')
 * @param options - Driver configuration options
 * @returns An instance of `IServerDriver` (`UWSServerDriver` or `WSServerDriver`)
 */
export function createServerDriver(
  kind: DriverKind = 'auto',
  options?: ServerDriverOptions
): IServerDriver {
  if (kind === 'uws') {
    if (isUWSAvailable()) {
      return new UWSServerDriver(options);
    }
    // Fallback to ws driver if uWS is requested but native binding is unavailable
    return new WSServerDriver(options);
  }

  if (kind === 'ws') {
    return new WSServerDriver(options);
  }

  // Auto-detect
  if (isUWSAvailable()) {
    return new UWSServerDriver(options);
  }
  return new WSServerDriver(options);
}

import { decodeStreamValue, encodeFrame, decodeFrame, encodeStreamValue, FrameType, type FrameTuple } from '@bxios/wire';

export interface SessionContext {
  readonly sessionId: string;
  token: string;
  authenticatedAt: number;
  refreshedAt: number;
  identity?: unknown;
  [key: string]: unknown;
}

export type AuthResult = boolean | unknown | null | undefined;

export interface ServerAuthOptions {
  /** Reject upgrades without a valid token. Defaults to true when auth is configured. */
  required?: boolean;
  validate: (token: string, context?: SessionContext) => AuthResult | Promise<AuthResult>;
  cookieNames?: string[];
  /** Optional prefix used for a subprotocol token, for example `auth.`. */
  protocolPrefix?: string;
  onAuthenticated?: (connectionId: string, context: SessionContext, refreshed: boolean) => void;
}

export interface AuthRequestHeaders {
  cookie?: string;
  'sec-websocket-protocol'?: string;
  [key: string]: string | string[] | undefined;
}

const defaultCookieNames = ['bxios_session', 'session', 'token', 'auth', 'access_token'];

export function extractAuthToken(headers: AuthRequestHeaders, options: Pick<ServerAuthOptions, 'cookieNames' | 'protocolPrefix'> = {}): string | undefined {
  const cookie = headers.cookie;
  if (cookie) {
    const values = new Map(cookie.split(';').map(part => {
      const index = part.indexOf('=');
      return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }));
    for (const name of options.cookieNames ?? defaultCookieNames) {
      const token = values.get(name);
      if (token) return token;
    }
    if (!cookie.includes('=')) return cookie.trim();
  }

  const raw = headers['sec-websocket-protocol'];
  const protocols = Array.isArray(raw) ? raw : raw?.split(',').map(value => value.trim());
  if (protocols) {
    const prefix = options.protocolPrefix;
    for (const protocol of protocols) {
      if (!protocol) continue;
      if (!prefix || protocol.startsWith(prefix)) return prefix ? protocol.slice(prefix.length) : protocol;
    }
  }
  return undefined;
}

function isAccepted(result: AuthResult): boolean {
  return result !== false && result !== null && result !== undefined;
}

export class AuthSessionManager {
  private readonly contexts = new Map<string, SessionContext>();

  constructor(private readonly options?: ServerAuthOptions) {}

  public get enabled(): boolean { return !!this.options; }
  public get required(): boolean { return !!this.options && this.options.required !== false; }

  public async authenticate(connectionId: string, token: string, previous?: SessionContext): Promise<SessionContext | undefined> {
    if (!this.options) return undefined;
    const result = await this.options.validate(token, previous);
    if (!isAccepted(result)) return undefined;
    const now = Date.now();
    const context = previous ?? {
      sessionId: crypto.randomUUID(),
      token,
      authenticatedAt: now,
      refreshedAt: now,
    };
    context.token = token;
    context.refreshedAt = now;
    if (result !== true) context.identity = result;
    this.contexts.set(connectionId, context);
    this.options.onAuthenticated?.(connectionId, context, !!previous);
    return context;
  }

  public async authenticateHeaders(connectionId: string, headers: AuthRequestHeaders): Promise<SessionContext | undefined> {
    const token = extractAuthToken(headers, this.options);
    if (!token) return undefined;
    return this.authenticate(connectionId, token);
  }

  public get(connectionId: string): SessionContext | undefined { return this.contexts.get(connectionId); }

  public associate(connectionId: string, context: SessionContext): void {
    this.contexts.set(connectionId, context);
  }

  public remove(connectionId: string): void { this.contexts.delete(connectionId); }

  /** Handles a type-5 frame and returns true when the frame was an auth frame. */
  public async handleFrame(connectionId: string, data: Uint8Array, send: (data: Uint8Array) => boolean | void): Promise<boolean> {
    if (!this.options) return false;
    let frame: FrameTuple;
    try { frame = decodeFrame(data); } catch { return false; }
    if (frame.type !== FrameType.Auth) return false;
    let token: unknown;
    try { token = decodeStreamValue<any>(frame.data); } catch { token = undefined; }
    if (typeof token === 'object' && token !== null) token = (token as any).token;
    const context = typeof token === 'string' ? await this.authenticate(connectionId, token, this.get(connectionId)) : undefined;
    const response: FrameTuple = {
      type: FrameType.Auth,
      id: frame.id,
      data: encodeStreamValue(context ? { authenticated: true, sessionId: context.sessionId } : { authenticated: false }),
      code: context ? 200 : 401,
    };
    send(encodeFrame(response));
    return true;
  }
}

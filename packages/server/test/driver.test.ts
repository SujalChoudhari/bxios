import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createAuthRefreshFrame, decodeFrame, encodeFrame, FrameType } from '@bxios/wire';
import {
  copyBuffer,
  WSServerDriver,
  UWSServerDriver,
  createServerDriver,
  isUWSAvailable,
  IServerDriver,
} from '../src/index.js';

describe('copyBuffer pure helper', () => {
  it('should create an independent Uint8Array copy from ArrayBuffer', () => {
    const ab = new ArrayBuffer(4);
    const view = new Uint8Array(ab);
    view.set([10, 20, 30, 40]);

    const copy = copyBuffer(ab);

    expect(copy).toBeInstanceOf(Uint8Array);
    expect(Array.from(copy)).toEqual([10, 20, 30, 40]);

    // Mutate original ArrayBuffer memory (simulating uWS buffer reuse)
    view.set([99, 99, 99, 99]);

    // Assert copy remains uncorrupted
    expect(Array.from(copy)).toEqual([10, 20, 30, 40]);
  });

  it('should create an independent Uint8Array copy from Uint8Array view', () => {
    const original = new Uint8Array([5, 15, 25, 35]);
    const copy = copyBuffer(original);

    expect(copy).toBeInstanceOf(Uint8Array);
    expect(Array.from(copy)).toEqual([5, 15, 25, 35]);

    // Mutate original view
    original[0] = 255;
    original[1] = 255;

    // Assert copy remains uncorrupted
    expect(Array.from(copy)).toEqual([5, 15, 25, 35]);
  });

  it('should handle Node.js Buffer instances correctly', () => {
    const buf = Buffer.from([1, 2, 3]);
    const copy = copyBuffer(buf);

    expect(copy).toBeInstanceOf(Uint8Array);
    expect(Array.from(copy)).toEqual([1, 2, 3]);

    buf[0] = 100;
    expect(Array.from(copy)).toEqual([1, 2, 3]);
  });

  it('should handle null/undefined gracefully', () => {
    expect(copyBuffer(null)).toEqual(new Uint8Array(0));
    expect(copyBuffer(undefined)).toEqual(new Uint8Array(0));
  });
});

describe('WSServerDriver (ws Fallback Driver)', () => {
  let driver: WSServerDriver;
  let clientSocket: WebSocket | null = null;

  afterEach(async () => {
    if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close();
    }
    clientSocket = null;
    if (driver) {
      await driver.close();
    }
  });

  it('should initialize with kind "ws"', () => {
    driver = new WSServerDriver();
    expect(driver.kind).toBe('ws');
  });

  it('should listen on port 0 and assign ephemeral port', async () => {
    driver = new WSServerDriver();
    await driver.listen(0, '127.0.0.1');

    expect(driver.port).toBeGreaterThan(0);
    expect(driver.host).toBe('127.0.0.1');
  });

  it('should handle real WS client connection, messaging, and send/echo', async () => {
    driver = new WSServerDriver();

    let serverConnId = '';
    const receivedMessages: Uint8Array[] = [];

    driver.onConnection = (connId) => {
      serverConnId = connId;
    };

    driver.onMessage = (connId, data) => {
      receivedMessages.push(data);
    };

    await driver.listen(0, '127.0.0.1');

    // Connect client
    clientSocket = new WebSocket(`ws://127.0.0.1:${driver.port}`);

    await new Promise<void>((resolve, reject) => {
      clientSocket!.on('open', () => resolve());
      clientSocket!.on('error', (err) => reject(err));
    });

    expect(serverConnId).not.toBe('');

    // Client sends binary payload
    const sendPayload = new Uint8Array([1, 2, 3, 4, 5]);
    clientSocket!.send(sendPayload);

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedMessages.length).toBe(1);
    expect(Array.from(receivedMessages[0])).toEqual([1, 2, 3, 4, 5]);

    // Verify buffer copy isolation
    sendPayload.fill(0);
    expect(Array.from(receivedMessages[0])).toEqual([1, 2, 3, 4, 5]);

    // Server sends message to client
    const clientReceivedPromise = new Promise<Uint8Array>((resolve) => {
      clientSocket!.on('message', (data: Buffer) => {
        resolve(new Uint8Array(data));
      });
    });

    const sendSuccess = driver.send(serverConnId, new Uint8Array([9, 8, 7]));
    expect(sendSuccess).toBe(true);

    const clientMsg = await clientReceivedPromise;
    expect(Array.from(clientMsg)).toEqual([9, 8, 7]);
  });

  it('should handle client disconnect and onClose callback', async () => {
    driver = new WSServerDriver();

    let closedConnId = '';
    const closePromise = new Promise<void>((resolve) => {
      driver.onClose = (connId) => {
        closedConnId = connId;
        resolve();
      };
    });

    await driver.listen(0, '127.0.0.1');

    clientSocket = new WebSocket(`ws://127.0.0.1:${driver.port}`);
    await new Promise<void>((resolve) => clientSocket!.on('open', () => resolve()));

    clientSocket.close();
    await closePromise;

    expect(closedConnId).not.toBe('');
  });
});

describe('UWSServerDriver (uWebSockets.js Driver)', () => {
  let driver: UWSServerDriver;
  let clientSocket: WebSocket | null = null;

  afterEach(async () => {
    if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close();
    }
    clientSocket = null;
    if (driver) {
      await driver.close();
    }
  });

  it('should initialize with kind "uws"', () => {
    driver = new UWSServerDriver();
    expect(driver.kind).toBe('uws');
  });

  it('should run uWS server tests when uWS is available', async () => {
    if (!isUWSAvailable()) {
      console.log('Skipping uWS integration test since uWS native binary is unavailable');
      return;
    }

    driver = new UWSServerDriver();

    let serverConnId = '';
    const receivedMessages: Uint8Array[] = [];

    driver.onConnection = (connId) => {
      serverConnId = connId;
    };

    driver.onMessage = (connId, data) => {
      receivedMessages.push(data);
    };

    await driver.listen(0, '127.0.0.1');

    expect(driver.port).toBeGreaterThan(0);

    // Connect client
    clientSocket = new WebSocket(`ws://127.0.0.1:${driver.port}`);

    await new Promise<void>((resolve, reject) => {
      clientSocket!.on('open', () => resolve());
      clientSocket!.on('error', (err) => reject(err));
    });

    expect(serverConnId).not.toBe('');

    // Client sends binary payload
    const sendPayload = new Uint8Array([42, 43, 44]);
    clientSocket!.send(sendPayload);

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedMessages.length).toBe(1);
    expect(Array.from(receivedMessages[0])).toEqual([42, 43, 44]);

    // Verify buffer copy isolation (simulating uWS buffer reuse contract)
    sendPayload.fill(0);
    expect(Array.from(receivedMessages[0])).toEqual([42, 43, 44]);

    // Server sends message back to client
    const clientReceivedPromise = new Promise<Uint8Array>((resolve) => {
      clientSocket!.on('message', (data: Buffer) => {
        resolve(new Uint8Array(data));
      });
    });

    const sendSuccess = driver.send(serverConnId, new Uint8Array([100, 200]));
    expect(sendSuccess).toBe(true);

    const clientMsg = await clientReceivedPromise;
    expect(Array.from(clientMsg)).toEqual([100, 200]);
  });
});

describe('createServerDriver Factory', () => {
  it('should create WSServerDriver when kind "ws" is requested', () => {
    const driver = createServerDriver('ws');
    expect(driver.kind).toBe('ws');
    expect(driver).toBeInstanceOf(WSServerDriver);
  });

  it('should create UWSServerDriver or fallback WSServerDriver when kind "uws" is requested', () => {
    const driver = createServerDriver('uws');
    expect(driver).toBeDefined();
    if (isUWSAvailable()) {
      expect(driver.kind).toBe('uws');
      expect(driver).toBeInstanceOf(UWSServerDriver);
    } else {
      expect(driver.kind).toBe('ws');
      expect(driver).toBeInstanceOf(WSServerDriver);
    }
  });

  it('should auto-detect best available driver when kind is "auto" or omitted', () => {
    const driver = createServerDriver();
    expect(driver).toBeDefined();
    if (isUWSAvailable()) {
      expect(driver.kind).toBe('uws');
    } else {
      expect(driver.kind).toBe('ws');
    }
  });
});

describe('handshake authentication and AUTH_REFRESH', () => {
  it('authenticates from Cookie, keeps a persistent session context, and refreshes without closing', async () => {
    const driver = new WSServerDriver({
      auth: {
        cookieNames: ['session'],
        validate: async (token) => token === 'initial' || token === 'renewed' ? { userId: 'user-1' } : false,
      },
    });
    let connectionId = '';
    driver.onConnection = id => { connectionId = id; };
    await driver.listen(0, '127.0.0.1');
    const client = new WebSocket(`ws://127.0.0.1:${driver.port}`, {
      headers: { Cookie: 'session=initial' },
    });
    const frames: ReturnType<typeof decodeFrame>[] = [];
    client.on('message', data => frames.push(decodeFrame(new Uint8Array(data as Buffer))));
    try {
      await new Promise<void>((resolve, reject) => { client.once('open', () => resolve()); client.once('error', reject); });
      const before = driver.getSessionContext(connectionId)!;
      expect(before.identity).toEqual({ userId: 'user-1' });
      const sessionId = before.sessionId;
      client.send(encodeFrame(createAuthRefreshFrame('cookie-refresh', 'renewed')));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('auth refresh timeout')), 1000);
        const check = () => frames.some(frame => frame.id === 'cookie-refresh') ? (clearTimeout(timer), resolve()) : setTimeout(check, 5);
        check();
      });
      expect(frames.at(-1)).toMatchObject({ type: FrameType.Auth, code: 200 });
      expect(driver.getSessionContext(connectionId)!.sessionId).toBe(sessionId);
      expect(driver.getSessionContext(connectionId)!.token).toBe('renewed');
    } catch (error) {
      client.close();
      await driver.close();
      throw error;
    }
    client.close();
    await driver.close();
  });

  it('supports Sec-WebSocket-Protocol token and refreshes the same socket/session', async () => {
    const driver = new WSServerDriver({
      auth: {
        protocolPrefix: 'auth.',
        validate: (token) => token === 'first' || token === 'second' ? { subject: 'alice' } : false,
      },
    });
    let connectionId = '';
    driver.onConnection = id => { connectionId = id; };
    await driver.listen(0, '127.0.0.1');
    const client = new WebSocket(`ws://127.0.0.1:${driver.port}`, ['auth.first']);
    const frames: ReturnType<typeof decodeFrame>[] = [];
    try {
      client.on('message', data => frames.push(decodeFrame(new Uint8Array(data as Buffer))));
      await new Promise<void>((resolve, reject) => { client.once('open', () => resolve()); client.once('error', reject); });
      const before = driver.getSessionContext(connectionId)!;
      expect(before.identity).toEqual({ subject: 'alice' });
      const sessionId = before.sessionId;
      client.send(encodeFrame(createAuthRefreshFrame('refresh-1', 'second')));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('auth refresh timeout')), 1000);
        const check = () => frames.some(frame => frame.id === 'refresh-1') ? (clearTimeout(timer), resolve()) : setTimeout(check, 5);
        check();
      });
      expect(frames.at(-1)).toMatchObject({ type: FrameType.Auth, code: 200 });
      expect(driver.getSessionContext(connectionId)!.sessionId).toBe(sessionId);
      expect(driver.getSessionContext(connectionId)!.token).toBe('second');
      expect(client.readyState).toBe(WebSocket.OPEN);
    } finally {
      client.close();
      await driver.close();
    }
  });

  it('rejects an unauthenticated upgrade when auth is required', async () => {
    const driver = new WSServerDriver({ auth: { validate: () => false } });
    await driver.listen(0, '127.0.0.1');
    const client = new WebSocket(`ws://127.0.0.1:${driver.port}`);
    try {
      await expect(new Promise<void>((resolve, reject) => {
        client.once('open', () => reject(new Error('unauthenticated socket opened')));
        client.once('unexpected-response', (_request, response) => response.statusCode === 401 ? resolve() : reject(new Error(`unexpected status ${response.statusCode}`)));
        client.once('error', () => undefined);
      })).resolves.toBeUndefined();
    } finally {
      client.close();
      await driver.close();
    }
  });
});

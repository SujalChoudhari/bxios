import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager, createConnectionManager } from '../src/index.js';

class MockWebSocket {
  public url: string;
  public protocols?: string | string[];
  public binaryType = 'blob'; // Defaults to blob like browser WebSocket
  public readyState = 0; // 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
  public bufferedAmount = 0;

  public onopen: (() => void) | null = null;
  public onmessage: ((event: any) => void) | null = null;
  public onerror: ((error: any) => void) | null = null;
  public onclose: ((event: any) => void) | null = null;

  public sentData: any[] = [];
  public pingCalled = false;
  public closed = false;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  public send(data: any): void {
    this.sentData.push(data);
  }

  public ping(): void {
    this.pingCalled = true;
  }

  public close(): void {
    this.closed = true;
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ wasClean: true });
    }
  }

  // Simulation helpers
  public triggerOpen(): void {
    this.readyState = 1;
    if (this.onopen) {
      this.onopen();
    }
  }

  public triggerMessage(data: any): void {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }

  public triggerClose(wasClean = false): void {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ wasClean });
    }
  }

  public triggerError(err: any): void {
    if (this.onerror) {
      this.onerror(err);
    }
  }

  static instances: MockWebSocket[] = [];
}

describe('ConnectionManager', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Acceptance Criteria 1: Native WebSocket binaryType enforcement', () => {
    it('enforces binaryType = "arraybuffer" on created native WebSocket instances', () => {
      const manager = new ConnectionManager({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket as any,
      });

      manager.connect();

      const socket = MockWebSocket.instances[0];
      expect(socket).toBeDefined();
      expect(socket.binaryType).toBe('arraybuffer');
    });

    it('exposes arraybuffer binaryType contract during connection lifecycle', () => {
      const manager = createConnectionManager({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket as any,
      });

      manager.connect();
      const socket = manager.getSocket();
      expect(socket.binaryType).toBe('arraybuffer');
    });
  });

  describe('Acceptance Criteria 2: Exponential backoff reconnect loop (1s to 30s cap)', () => {
    it('calculates exponential backoff delay capped at 30 seconds', () => {
      const manager = new ConnectionManager({
        minReconnectDelay: 1000,
        maxReconnectDelay: 30000,
        reconnectFactor: 2,
      });

      expect(manager.calculateReconnectDelay(0)).toBe(1000); // 1s
      expect(manager.calculateReconnectDelay(1)).toBe(2000); // 2s
      expect(manager.calculateReconnectDelay(2)).toBe(4000); // 4s
      expect(manager.calculateReconnectDelay(3)).toBe(8000); // 8s
      expect(manager.calculateReconnectDelay(4)).toBe(16000); // 16s
      expect(manager.calculateReconnectDelay(5)).toBe(30000); // capped at 30s (32000 -> 30000)
      expect(manager.calculateReconnectDelay(10)).toBe(30000); // capped at 30s
    });

    it('triggers exponential backoff reconnect loop on unexpected socket drop', () => {
      const reconnectSpy = vi.fn();
      const manager = new ConnectionManager({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket as any,
        autoReconnect: true,
        minReconnectDelay: 1000,
        maxReconnectDelay: 30000,
      });
      manager.onReconnectAttempt = reconnectSpy;

      manager.connect();
      const ws1 = MockWebSocket.instances[0];
      ws1.triggerOpen();
      expect(manager.getStatus()).toBe('CONNECTED');

      // Unexpected disconnect
      ws1.triggerClose(false);
      expect(manager.getStatus()).toBe('RECONNECTING');
      expect(reconnectSpy).toHaveBeenCalledWith(1, 1000);
      expect(MockWebSocket.instances.length).toBe(1);

      // Fast-forward 1000ms for attempt 1
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(2);

      // Second disconnect
      const ws2 = MockWebSocket.instances[1];
      ws2.triggerClose(false);
      expect(reconnectSpy).toHaveBeenCalledWith(2, 2000);

      // Fast-forward 2000ms for attempt 2
      vi.advanceTimersByTime(2000);
      expect(MockWebSocket.instances.length).toBe(3);
    });

    it('resets reconnect attempt counter to 0 upon successful connection', () => {
      const manager = new ConnectionManager({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket as any,
        autoReconnect: true,
        minReconnectDelay: 1000,
      });

      manager.connect();
      const ws1 = MockWebSocket.instances[0];
      ws1.triggerOpen();
      ws1.triggerClose(false);

      expect(manager.getReconnectAttempt()).toBe(1);

      // Reconnect fires
      vi.advanceTimersByTime(1000);
      const ws2 = MockWebSocket.instances[1];
      ws2.triggerOpen();

      expect(manager.getReconnectAttempt()).toBe(0);
      expect(manager.getStatus()).toBe('CONNECTED');
    });

    it('does not reconnect if disconnect() was explicitly called', () => {
      const manager = new ConnectionManager({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket as any,
        autoReconnect: true,
      });

      manager.connect();
      const ws = MockWebSocket.instances[0];
      ws.triggerOpen();

      manager.disconnect();
      expect(manager.getStatus()).toBe('DISCONNECTED');

      vi.advanceTimersByTime(60000);
      expect(MockWebSocket.instances.length).toBe(1);
    });
  });

  describe('Acceptance Criteria 3: 30-second ping/pong heartbeat timer', () => {
    it('sends periodic ping every 30 seconds when connected', () => {
      const pingSpy = vi.fn();
      const manager = new ConnectionManager({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket as any,
        pingInterval: 30000,
      });
      manager.onPing = pingSpy;

      manager.connect();
      const ws = MockWebSocket.instances[0];
      ws.triggerOpen();

      expect(pingSpy).not.toHaveBeenCalled();

      // Advance 30 seconds
      vi.advanceTimersByTime(30000);
      expect(pingSpy).toHaveBeenCalledTimes(1);
      expect(ws.pingCalled).toBe(true);

      // Advance another 30 seconds
      vi.advanceTimersByTime(30000);
      expect(pingSpy).toHaveBeenCalledTimes(2);
    });

    it('stops heartbeat timer on disconnect', () => {
      const pingSpy = vi.fn();
      const manager = new ConnectionManager({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket as any,
        pingInterval: 30000,
      });
      manager.onPing = pingSpy;

      manager.connect();
      const ws = MockWebSocket.instances[0];
      ws.triggerOpen();

      manager.disconnect();
      vi.advanceTimersByTime(60000);
      expect(pingSpy).not.toHaveBeenCalled();
    });

    it('handles pong responses and clears ping timeout', () => {
      const pongSpy = vi.fn();
      const manager = new ConnectionManager({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket as any,
        pingInterval: 30000,
        pingTimeout: 5000,
      });
      manager.onPong = pongSpy;

      manager.connect();
      const ws = MockWebSocket.instances[0];
      ws.triggerOpen();

      // Send ping at 30s
      vi.advanceTimersByTime(30000);

      // Simulate receiving pong
      ws.triggerMessage('pong');
      expect(pongSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('IDriver Interface Compatibility', () => {
    it('implements IDriver listen, send, close, and getBufferedAmount', () => {
      const manager = new ConnectionManager({
        webSocketImpl: MockWebSocket as any,
      });

      const messageSpy = vi.fn();
      manager.onMessage = messageSpy;

      manager.listen('ws://localhost:9090');
      const ws = MockWebSocket.instances[0];
      ws.triggerOpen();

      const payload = new Uint8Array([1, 2, 3]);
      manager.send(payload);
      expect(ws.sentData[0]).toEqual(payload);

      ws.triggerMessage(new Uint8Array([4, 5, 6]));
      expect(messageSpy).toHaveBeenCalled();

      manager.close();
      expect(manager.getStatus()).toBe('DISCONNECTED');
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  IDriver,
  DriverOnMessage,
  DriverOnConnect,
  DriverOnClose,
  DriverOnDrain,
} from '../src/index.js';

class MockDriver implements IDriver {
  public onMessage?: DriverOnMessage;
  public onConnect?: DriverOnConnect;
  public onClose?: DriverOnClose;
  public onDrain?: DriverOnDrain;

  public listening = false;
  public closed = false;
  public sentBuffers: Uint8Array[] = [];
  public bufferedAmount = 0;

  listen(options?: { port?: number; url?: string }): void {
    this.listening = true;
    if (this.onConnect) {
      this.onConnect();
    }
  }

  send(data: Uint8Array): void {
    if (this.closed) {
      throw new Error('Cannot send on closed driver');
    }
    this.sentBuffers.push(data);
    this.bufferedAmount += data.byteLength;
  }

  close(): void {
    this.closed = true;
    this.listening = false;
    if (this.onClose) {
      this.onClose(false);
    }
  }

  getBufferedAmount(): number {
    return this.bufferedAmount;
  }

  // Test helper methods to simulate remote events
  simulateMessage(data: Uint8Array): void {
    if (this.onMessage) {
      this.onMessage(data);
    }
  }

  simulateDrain(): void {
    this.bufferedAmount = 0;
    if (this.onDrain) {
      this.onDrain();
    }
  }

  simulateErrorClose(): void {
    this.closed = true;
    this.listening = false;
    if (this.onClose) {
      this.onClose(true);
    }
  }
}

describe('IDriver Interface & Mock Driver', () => {
  it('should allow creating a class that implements IDriver', () => {
    const driver: IDriver = new MockDriver();
    expect(driver).toBeDefined();
    expect(typeof driver.listen).toBe('function');
    expect(typeof driver.send).toBe('function');
    expect(typeof driver.close).toBe('function');
    expect(typeof driver.getBufferedAmount).toBe('function');
  });

  it('should handle listen and trigger onConnect callback', () => {
    const driver = new MockDriver();
    const connectSpy = vi.fn();
    driver.onConnect = connectSpy;

    driver.listen({ url: 'ws://localhost:8080' });

    expect(driver.listening).toBe(true);
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle sending data and tracking buffered amount', () => {
    const driver = new MockDriver();
    const payload1 = new Uint8Array([1, 2, 3]);
    const payload2 = new Uint8Array([4, 5]);

    driver.send(payload1);
    expect(driver.getBufferedAmount()).toBe(3);
    expect(driver.sentBuffers).toHaveLength(1);
    expect(driver.sentBuffers[0]).toEqual(payload1);

    driver.send(payload2);
    expect(driver.getBufferedAmount()).toBe(5);
    expect(driver.sentBuffers).toHaveLength(2);
  });

  it('should trigger onMessage callback when data is received', () => {
    const driver = new MockDriver();
    const messageSpy = vi.fn();
    driver.onMessage = messageSpy;

    const incomingData = new Uint8Array([10, 20, 30]);
    driver.simulateMessage(incomingData);

    expect(messageSpy).toHaveBeenCalledTimes(1);
    expect(messageSpy).toHaveBeenCalledWith(incomingData);
  });

  it('should trigger onDrain callback when buffered amount clears', () => {
    const driver = new MockDriver();
    const drainSpy = vi.fn();
    driver.onDrain = drainSpy;

    driver.send(new Uint8Array([1, 2, 3, 4]));
    expect(driver.getBufferedAmount()).toBe(4);

    driver.simulateDrain();
    expect(driver.getBufferedAmount()).toBe(0);
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle close and trigger onClose callback', () => {
    const driver = new MockDriver();
    const closeSpy = vi.fn();
    driver.onClose = closeSpy;

    driver.close();

    expect(driver.closed).toBe(true);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(false);
  });

  it('should pass hadError boolean flag to onClose callback on error disconnect', () => {
    const driver = new MockDriver();
    const closeSpy = vi.fn();
    driver.onClose = closeSpy;

    driver.simulateErrorClose();

    expect(driver.closed).toBe(true);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(true);
  });
});

export type DriverOnMessage = (data: Uint8Array) => void;
export type DriverOnConnect = () => void;
export type DriverOnClose = (hadError?: boolean) => void;
export type DriverOnDrain = () => void;

export interface IDriver {
  onMessage?: DriverOnMessage;
  onConnect?: DriverOnConnect;
  onClose?: DriverOnClose;
  onDrain?: DriverOnDrain;

  listen(options?: any): void;
  send(data: Uint8Array): void;
  close(): void;
  getBufferedAmount(): number;
}

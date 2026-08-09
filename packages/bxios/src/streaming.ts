import { decodeStreamValue, createStreamCancelFrame, createStreamStartFrame, encodeFrame, decodeFrame, FrameType, type IDriver } from '@bxios/wire';
import type { StreamRequest } from '@bxios/wire';

interface PendingStream { controller?: ReadableStreamDefaultController<unknown>; started: boolean; }

export class MultiplexedStreamingClient {
  private nextStreamId = 1;
  private streams = new Map<number, PendingStream>();
  private previousOnMessage?: IDriver['onMessage'];

  constructor(private readonly driver: IDriver) {
    this.previousOnMessage = driver.onMessage;
    driver.onMessage = (data) => {
      this.previousOnMessage?.(data);
      this.handleMessage(data);
    };
  }

  public stream<T = unknown>(request: StreamRequest): ReadableStream<T> {
    const streamId = this.nextStreamId++;
    const id = `stream-${streamId}`;
    let pending: PendingStream;
    const stream = new ReadableStream<T>({
      start: (controller) => {
        pending = { controller: controller as ReadableStreamDefaultController<unknown>, started: false };
        this.streams.set(streamId, pending);
        this.driver.send(encodeFrame(createStreamStartFrame(id, streamId, request)));
      },
      cancel: (reason) => {
        this.streams.delete(streamId);
        this.driver.send(encodeFrame(createStreamCancelFrame(id, streamId, reason)));
      },
    });
    return stream;
  }

  private handleMessage(data: Uint8Array): void {
    let frame;
    try { frame = decodeFrame(data); } catch { return; }
    if (frame.streamId === undefined || !this.streams.has(frame.streamId)) return;
    const pending = this.streams.get(frame.streamId)!;
    if (frame.type === FrameType.StreamStart) {
      pending.started = true;
    } else if (frame.type === FrameType.StreamChunk) {
      pending.controller?.enqueue(decodeStreamValue(frame.data));
    } else if (frame.type === FrameType.StreamEnd) {
      this.streams.delete(frame.streamId);
      if ((frame.code ?? 200) >= 400) pending.controller?.error(new Error(String(frame.metadata?.message ?? 'Stream failed')));
      else pending.controller?.close();
    }
  }
}

export const StreamingClient = MultiplexedStreamingClient;

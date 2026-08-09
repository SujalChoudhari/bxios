import { decode, encode } from '@msgpack/msgpack';
import { FrameType, FrameTuple } from './types.js';

export interface StreamRequest {
  method?: string;
  path?: string;
  url?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  context?: unknown;
  [key: string]: unknown;
}

export interface StreamStartPayload {
  request: StreamRequest;
}

export function encodeStreamValue(value: unknown): Uint8Array {
  return encode(value);
}

export function decodeStreamValue<T = unknown>(data: Uint8Array): T {
  return decode(data) as T;
}

export function createStreamStartFrame(id: string, streamId: number, request: StreamRequest): FrameTuple {
  return { type: FrameType.StreamStart, id, streamId, data: encodeStreamValue({ request }) };
}

export function createStreamChunkFrame(id: string, streamId: number, value: unknown): FrameTuple {
  return { type: FrameType.StreamChunk, id, streamId, data: encodeStreamValue(value) };
}

export function createStreamEndFrame(id: string, streamId: number, code = 200, metadata?: Record<string, unknown>): FrameTuple {
  return { type: FrameType.StreamEnd, id, streamId, data: new Uint8Array(), code, metadata };
}

export function createStreamCancelFrame(id: string, streamId: number, reason?: unknown): FrameTuple {
  return { type: FrameType.StreamCancel, id, streamId, data: reason === undefined ? new Uint8Array() : encodeStreamValue(reason) };
}

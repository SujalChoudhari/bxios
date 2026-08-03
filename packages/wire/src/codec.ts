import { encode, decode } from '@msgpack/msgpack';
import { FrameType, FrameTuple, RawFrameTuple } from './types.js';
import { FrameError } from './errors.js';

function isBuffer(obj: any): boolean {
  return typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).Buffer !== 'undefined' &&
    typeof (globalThis as any).Buffer.isBuffer === 'function'
    ? (globalThis as any).Buffer.isBuffer(obj)
    : false;
}

export function encodeFrame(frame: FrameTuple): Uint8Array {
  if (!frame || typeof frame !== 'object') {
    throw new FrameError('Invalid frame: frame must be an object');
  }

  if (
    typeof frame.type !== 'number' ||
    !Number.isInteger(frame.type) ||
    frame.type < 0 ||
    frame.type > 5
  ) {
    throw new FrameError(`Invalid frame type: ${frame.type}`);
  }

  if (typeof frame.id !== 'string' || frame.id.length === 0) {
    throw new FrameError('Invalid frame id: id must be a non-empty string');
  }

  if (
    frame.streamId !== undefined &&
    frame.streamId !== null &&
    (typeof frame.streamId !== 'number' || isNaN(frame.streamId))
  ) {
    throw new FrameError('Invalid streamId: streamId must be a number');
  }

  const isUint8 = frame.data instanceof Uint8Array;
  const isArrayBuf = frame.data instanceof ArrayBuffer;
  const isBuf = isBuffer(frame.data);

  if (!frame.data || (!isUint8 && !isArrayBuf && !isBuf)) {
    throw new FrameError('Invalid frame data: data must be a Uint8Array');
  }

  if (
    frame.metadata !== undefined &&
    frame.metadata !== null &&
    (typeof frame.metadata !== 'object' || Array.isArray(frame.metadata))
  ) {
    throw new FrameError('Invalid metadata: metadata must be an object');
  }

  if (
    frame.code !== undefined &&
    frame.code !== null &&
    (typeof frame.code !== 'number' || isNaN(frame.code))
  ) {
    throw new FrameError('Invalid frame code: code must be a number');
  }

  const dataBytes = isUint8
    ? (frame.data as Uint8Array)
    : new Uint8Array(frame.data as unknown as ArrayBuffer);

  const tuple: RawFrameTuple = [
    frame.type,
    frame.id,
    frame.streamId ?? null,
    dataBytes,
    frame.metadata ?? null,
    frame.code ?? null,
  ];

  try {
    return encode(tuple);
  } catch (err: any) {
    throw new FrameError(`Failed to encode frame: ${err?.message || err}`);
  }
}

export function decodeFrame(buf: Uint8Array): FrameTuple {
  const isUint8 = buf instanceof Uint8Array;
  const isArrayBuf = buf instanceof ArrayBuffer;
  const isBuf = isBuffer(buf);

  if (!buf || (!isUint8 && !isArrayBuf && !isBuf)) {
    throw new FrameError('Invalid input: buf must be a Uint8Array');
  }

  const inputBytes = isUint8
    ? buf
    : new Uint8Array(buf as unknown as ArrayBuffer);

  let decoded: unknown;
  try {
    decoded = decode(inputBytes);
  } catch (err: any) {
    throw new FrameError(`Corrupted frame buffer: ${err?.message || err}`);
  }

  if (!Array.isArray(decoded) || decoded.length !== 6) {
    throw new FrameError(
      `Invalid frame tuple structure: expected 6-element array, got ${
        Array.isArray(decoded) ? decoded.length + '-element array' : typeof decoded
      }`
    );
  }

  const [type, id, streamId, data, metadata, code] = decoded;

  if (
    typeof type !== 'number' ||
    !Number.isInteger(type) ||
    type < 0 ||
    type > 5
  ) {
    throw new FrameError(`Invalid FrameType in frame tuple: ${type}`);
  }

  if (typeof id !== 'string' || id.length === 0) {
    throw new FrameError('Invalid frame id in frame tuple: must be a non-empty string');
  }

  if (
    streamId !== null &&
    streamId !== undefined &&
    (typeof streamId !== 'number' || isNaN(streamId))
  ) {
    throw new FrameError('Invalid streamId in frame tuple: must be a number or null');
  }

  const isDataUint8 = data instanceof Uint8Array;
  const isDataArrayBuf = data instanceof ArrayBuffer;
  const isDataBuf = isBuffer(data);

  if (!data || (!isDataUint8 && !isDataArrayBuf && !isDataBuf)) {
    throw new FrameError('Invalid data payload in frame tuple: must be a Uint8Array');
  }

  if (
    metadata !== null &&
    metadata !== undefined &&
    (typeof metadata !== 'object' || Array.isArray(metadata))
  ) {
    throw new FrameError('Invalid metadata in frame tuple: must be an object or null');
  }

  if (
    code !== null &&
    code !== undefined &&
    (typeof code !== 'number' || isNaN(code))
  ) {
    throw new FrameError('Invalid code in frame tuple: must be a number or null');
  }

  const dataBytes = isDataUint8
    ? (data as Uint8Array)
    : new Uint8Array(data as unknown as ArrayBuffer);

  const frame: FrameTuple = {
    type: type as FrameType,
    id: id as string,
    data: dataBytes,
  };

  if (streamId !== null && streamId !== undefined) {
    frame.streamId = streamId as number;
  }
  if (metadata !== null && metadata !== undefined) {
    frame.metadata = metadata as Record<string, unknown>;
  }
  if (code !== null && code !== undefined) {
    frame.code = code as number;
  }

  return frame;
}

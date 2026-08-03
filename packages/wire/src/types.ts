export enum FrameType {
  Unary = 0,
  StreamStart = 1,
  StreamChunk = 2,
  StreamEnd = 3,
  StreamCancel = 4,
  Auth = 5,
}

export interface FrameTuple {
  type: FrameType;
  id: string;
  streamId?: number;
  data: Uint8Array;
  metadata?: Record<string, unknown>;
  code?: number;
}

export type RawFrameTuple = [
  type: FrameType,
  id: string,
  streamId: number | null,
  data: Uint8Array,
  metadata: Record<string, unknown> | null,
  code: number | null,
];

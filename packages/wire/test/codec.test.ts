import { describe, it, expect } from 'vitest';
import { encode } from '@msgpack/msgpack';
import { FrameType, FrameTuple } from '../src/types.js';
import { FrameError } from '../src/errors.js';
import { encodeFrame, decodeFrame } from '../src/codec.js';

describe('MessagePack Frame Codec', () => {
  describe('Roundtrip Encode and Decode', () => {
    const frameTypes = [
      { name: 'Unary', type: FrameType.Unary },
      { name: 'StreamStart', type: FrameType.StreamStart },
      { name: 'StreamChunk', type: FrameType.StreamChunk },
      { name: 'StreamEnd', type: FrameType.StreamEnd },
      { name: 'StreamCancel', type: FrameType.StreamCancel },
      { name: 'Auth', type: FrameType.Auth },
    ];

    frameTypes.forEach(({ name, type }) => {
      it(`should correctly encode and decode a ${name} frame (type=${type})`, () => {
        const original: FrameTuple = {
          type,
          id: `frame-${type}-123`,
          data: new Uint8Array([1, 2, 3, 4, 5]),
        };

        const encoded = encodeFrame(original);
        expect(encoded).toBeInstanceOf(Uint8Array);

        const decoded = decodeFrame(encoded);
        expect(decoded.type).toBe(type);
        expect(decoded.id).toBe(original.id);
        expect(decoded.data).toEqual(original.data);
        expect(decoded.streamId).toBeUndefined();
        expect(decoded.metadata).toBeUndefined();
        expect(decoded.code).toBeUndefined();
      });
    });

    it('should correctly encode and decode all optional fields', () => {
      const original: FrameTuple = {
        type: FrameType.StreamStart,
        id: 'stream-req-456',
        streamId: 42,
        data: new Uint8Array([10, 20, 30]),
        metadata: { 'content-type': 'application/json', authorization: 'Bearer token' },
        code: 200,
      };

      const encoded = encodeFrame(original);
      const decoded = decodeFrame(encoded);

      expect(decoded.type).toBe(FrameType.StreamStart);
      expect(decoded.id).toBe('stream-req-456');
      expect(decoded.streamId).toBe(42);
      expect(decoded.data).toEqual(new Uint8Array([10, 20, 30]));
      expect(decoded.metadata).toEqual({
        'content-type': 'application/json',
        authorization: 'Bearer token',
      });
      expect(decoded.code).toBe(200);
    });

    it('should handle empty data payloads', () => {
      const original: FrameTuple = {
        type: FrameType.StreamEnd,
        id: 'end-789',
        streamId: 1,
        data: new Uint8Array(0),
      };

      const encoded = encodeFrame(original);
      const decoded = decodeFrame(encoded);

      expect(decoded.type).toBe(FrameType.StreamEnd);
      expect(decoded.id).toBe('end-789');
      expect(decoded.streamId).toBe(1);
      expect(decoded.data).toEqual(new Uint8Array(0));
    });
  });

  describe('Invalid Frame Validation during Encoding', () => {
    it('should reject invalid frame objects', () => {
      expect(() => encodeFrame(null as any)).toThrow(FrameError);
      expect(() => encodeFrame(undefined as any)).toThrow(FrameError);
      expect(() => encodeFrame('not an object' as any)).toThrow(FrameError);
    });

    it('should reject invalid FrameTypes', () => {
      const invalidTypes = [-1, 6, 10, 1.5, '0', null, undefined];
      invalidTypes.forEach((type) => {
        const frame: any = {
          type,
          id: 'test-id',
          data: new Uint8Array([1]),
        };
        expect(() => encodeFrame(frame)).toThrow(FrameError);
      });
    });

    it('should reject missing or empty id', () => {
      const invalidIds = ['', null, undefined, 123, {}];
      invalidIds.forEach((id) => {
        const frame: any = {
          type: FrameType.Unary,
          id,
          data: new Uint8Array([1]),
        };
        expect(() => encodeFrame(frame)).toThrow(FrameError);
      });
    });

    it('should reject invalid data payloads', () => {
      const invalidDatas = ['string data', 12345, null, undefined, { key: 'val' }];
      invalidDatas.forEach((data) => {
        const frame: any = {
          type: FrameType.Unary,
          id: 'test-id',
          data,
        };
        expect(() => encodeFrame(frame)).toThrow(FrameError);
      });
    });

    it('should reject invalid streamId', () => {
      const frame: any = {
        type: FrameType.StreamChunk,
        id: 'chunk-1',
        streamId: 'not-a-number',
        data: new Uint8Array([1]),
      };
      expect(() => encodeFrame(frame)).toThrow(FrameError);
    });

    it('should reject invalid metadata', () => {
      const frame: any = {
        type: FrameType.Unary,
        id: 'test-id',
        data: new Uint8Array([1]),
        metadata: 'invalid-metadata-string',
      };
      expect(() => encodeFrame(frame)).toThrow(FrameError);
    });
  });

  describe('Invalid Frame Validation during Decoding', () => {
    it('should reject invalid input buffer', () => {
      expect(() => decodeFrame(null as any)).toThrow(FrameError);
      expect(() => decodeFrame(undefined as any)).toThrow(FrameError);
      expect(() => decodeFrame('not a uint8array' as any)).toThrow(FrameError);
    });

    it('should reject corrupted MessagePack buffer', () => {
      const corruptedBytes = new Uint8Array([0xc1, 0xff, 0xfe, 0xfd]); // invalid msgpack byte sequences
      expect(() => decodeFrame(corruptedBytes)).toThrow(FrameError);
    });

    it('should reject non-tuple MessagePack data (maps, numbers, short arrays)', () => {
      const mapEncoded = encode({ type: 0, id: 'test' });
      expect(() => decodeFrame(mapEncoded)).toThrow(FrameError);

      const shortArrayEncoded = encode([0, 'id', null, new Uint8Array([1])]); // 4 elements instead of 6
      expect(() => decodeFrame(shortArrayEncoded)).toThrow(FrameError);

      const longArrayEncoded = encode([0, 'id', null, new Uint8Array([1]), null, null, 'extra']); // 7 elements
      expect(() => decodeFrame(longArrayEncoded)).toThrow(FrameError);
    });

    it('should reject frame tuple with invalid FrameType (out of range or non-integer)', () => {
      const invalidTypeTuple = encode([99, 'id-1', null, new Uint8Array([1]), null, null]);
      expect(() => decodeFrame(invalidTypeTuple)).toThrow(FrameError);

      const negativeTypeTuple = encode([-1, 'id-1', null, new Uint8Array([1]), null, null]);
      expect(() => decodeFrame(negativeTypeTuple)).toThrow(FrameError);
    });

    it('should reject frame tuple with missing or empty id', () => {
      const emptyIdTuple = encode([0, '', null, new Uint8Array([1]), null, null]);
      expect(() => decodeFrame(emptyIdTuple)).toThrow(FrameError);

      const nullIdTuple = encode([0, null, null, new Uint8Array([1]), null, null]);
      expect(() => decodeFrame(nullIdTuple)).toThrow(FrameError);
    });

    it('should reject frame tuple with invalid data payload', () => {
      const invalidDataTuple = encode([0, 'id-1', null, 'not binary data', null, null]);
      expect(() => decodeFrame(invalidDataTuple)).toThrow(FrameError);
    });

    it('should reject frame tuple with invalid streamId', () => {
      const invalidStreamIdTuple = encode([1, 'id-1', 'invalid-stream-id', new Uint8Array([1]), null, null]);
      expect(() => decodeFrame(invalidStreamIdTuple)).toThrow(FrameError);
    });

    it('should reject frame tuple with invalid metadata', () => {
      const invalidMetadataTuple = encode([0, 'id-1', null, new Uint8Array([1]), 'invalid-metadata', null]);
      expect(() => decodeFrame(invalidMetadataTuple)).toThrow(FrameError);
    });
  });
});

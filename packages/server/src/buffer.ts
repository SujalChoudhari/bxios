/**
 * Safely copies binary data from an ArrayBuffer, Uint8Array, or Buffer into a fresh Uint8Array.
 *
 * uWebSockets.js reuses its internal ArrayBuffer memory allocation across consecutive incoming
 * WebSocket message callbacks. Downstream application logic that holds onto or processes incoming
 * buffer data asynchronously would experience silent data corruption when uWS overwrites the memory
 * for subsequent messages.
 *
 * By calling `copyBuffer` (which executes a zero-offset memory clone `buf.slice(0)` / buffer slicing),
 * we guarantee that the delivered Uint8Array owns its own independent memory allocation.
 *
 * @param buf - The raw incoming binary payload (ArrayBuffer, Uint8Array, Buffer, or ArrayBufferView)
 * @returns A fresh Uint8Array with an independent, isolated ArrayBuffer copy.
 */
export function copyBuffer(buf: ArrayBuffer | ArrayBufferView | Buffer | Uint8Array | null | undefined): Uint8Array {
  if (!buf) {
    return new Uint8Array(0);
  }

  if (Array.isArray(buf)) {
    const combined = Buffer.concat(buf);
    return new Uint8Array(
      combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength)
    );
  }

  if (buf instanceof ArrayBuffer) {
    return new Uint8Array(buf.slice(0));
  }

  if (ArrayBuffer.isView(buf)) {
    const view = buf as ArrayBufferView;
    return new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    );
  }

  const b = Buffer.from(buf as any);
  return new Uint8Array(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  );
}

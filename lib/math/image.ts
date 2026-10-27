// Checks on the handwriting picture a browser sends for recognition: a PNG of bounded size and
// dimensions, given as base64 (a data: URL prefix is accepted and removed).

export const IMAGE_LIMITS = {
  /** Decoded bytes. */
  maxBytes: 3 * 1024 * 1024,
  maxWidth: 2048,
  maxHeight: 8192,
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's header chunk, or null when the bytes are not a PNG. */
export const readPngSize = (bytes: Uint8Array) => {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((value, n) => bytes[n] === value)) return null;
  // The first chunk must be IHDR: length (4 bytes), "IHDR", width, height (big-endian).
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

export type CheckedImage =
  | { ok: true; base64: string; width: number; height: number; bytes: number }
  | { ok: false; error: string; status: number };

/** Validates a base64 PNG against the limits; returns the bare base64 to send on. */
export const checkPngImage = (value: unknown, limits = IMAGE_LIMITS): CheckedImage => {
  if (typeof value !== "string" || !value)
    return { ok: false, status: 400, error: "image must be a PNG as base64." };
  const base64 = value.replace(/^data:image\/png;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    return { ok: false, status: 400, error: "image must be a PNG as base64." };
  if (Math.floor((base64.length * 3) / 4) > limits.maxBytes + 3)
    return { ok: false, status: 413, error: "The picture of the handwriting is too large." };

  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  if (bytes.length > limits.maxBytes)
    return { ok: false, status: 413, error: "The picture of the handwriting is too large." };
  const size = readPngSize(bytes);
  if (!size) return { ok: false, status: 400, error: "image must be a PNG." };
  if (
    size.width < 1 ||
    size.height < 1 ||
    size.width > limits.maxWidth ||
    size.height > limits.maxHeight
  )
    return { ok: false, status: 413, error: "The picture of the handwriting is too large." };
  return { ok: true, base64, width: size.width, height: size.height, bytes: bytes.length };
};

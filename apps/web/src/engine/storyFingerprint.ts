export interface StoryHeaderInfo {
  storyId: string;
  format: 'zcode' | 'zblorb';
  zVersion: number | null;
  release: number | null;
  serial: string | null;
  checksum: number | null;
  ifid: string | null;
  byteLength: number;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length && offset + i < bytes.length; i++) {
    const code = bytes[offset + i];
    out += code >= 32 && code <= 126 ? String.fromCharCode(code) : '';
  }
  return out;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

/**
 * Extracts raw Z-code header bytes if the file is a Blorb (.zblorb) container,
 * or returns the bytes directly if it is a raw .z1-.z8 story file.
 */
export function extractZCodeSlice(bytes: Uint8Array): {
  format: 'zcode' | 'zblorb';
  zBytes: Uint8Array | null;
  ifid: string | null;
} {
  if (bytes.length < 64) {
    return { format: 'zcode', zBytes: null, ifid: null };
  }

  const isBlorb =
    readAscii(bytes, 0, 4) === 'FORM' && readAscii(bytes, 8, 4) === 'IFRS';

  if (!isBlorb) {
    const version = bytes[0];
    if (version >= 1 && version <= 8) {
      return { format: 'zcode', zBytes: bytes, ifid: null };
    }
    return { format: 'zcode', zBytes: null, ifid: null };
  }

  // Walk IFF chunks inside Blorb to locate ZCOD and optional IFmd (Treaty of Babel XML)
  let offset = 12;
  let zBytes: Uint8Array | null = null;
  let ifid: string | null = null;

  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkLen = readUint32BE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(dataStart + chunkLen, bytes.length);

    if (chunkId === 'ZCOD') {
      zBytes = bytes.subarray(dataStart, dataEnd);
    } else if (chunkId === 'IFmd') {
      const xml = new TextDecoder('utf-8', { fatal: false }).decode(
        bytes.subarray(dataStart, dataEnd),
      );
      const match = xml.match(/<ifid>([^<]+)<\/ifid>/i);
      if (match) {
        ifid = match[1].trim();
      }
    }

    // IFF chunks are 2-byte aligned
    offset = dataStart + chunkLen + (chunkLen % 2);
  }

  return { format: 'zblorb', zBytes, ifid };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function fingerprintStory(bytes: Uint8Array): Promise<StoryHeaderInfo> {
  const { format, zBytes, ifid } = extractZCodeSlice(bytes);
  const hash = (await sha256Hex(bytes)).slice(0, 24);

  if (!zBytes || zBytes.length < 64) {
    return {
      storyId: `zstory-${hash}`,
      format,
      zVersion: null,
      release: null,
      serial: null,
      checksum: null,
      ifid,
      byteLength: bytes.byteLength,
    };
  }

  const zVersion = zBytes[0];
  const release = readUint16BE(zBytes, 0x02);
  const serial = readAscii(zBytes, 0x12, 6);
  const checksum = readUint16BE(zBytes, 0x1c);

  // Standard Treaty of Babel Z-code IFID format: ZCODE-<release>-<serial>-<checksum>
  const computedIfid =
    ifid ??
    `ZCODE-${release}-${serial || '000000'}-${checksum.toString(16).toUpperCase().padStart(4, '0')}`;

  return {
    storyId: `${computedIfid.toLowerCase()}-${hash.slice(0, 12)}`,
    format,
    zVersion,
    release,
    serial: serial || null,
    checksum,
    ifid: computedIfid,
    byteLength: bytes.byteLength,
  };
}

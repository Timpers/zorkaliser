import { describe, expect, it } from 'vitest';
import { extractZCodeSlice, fingerprintStory } from './storyFingerprint.js';

function makeZCodeBytes(version = 3, release = 88, serial = '840726', checksum = 0x1a2b): Uint8Array {
  const bytes = new Uint8Array(128);
  bytes[0] = version;
  bytes[0x02] = (release >> 8) & 0xff;
  bytes[0x03] = release & 0xff;
  for (let i = 0; i < 6; i++) {
    bytes[0x12 + i] = serial.charCodeAt(i);
  }
  bytes[0x1c] = (checksum >> 8) & 0xff;
  bytes[0x1d] = checksum & 0xff;
  return bytes;
}

describe('storyFingerprint', () => {
  it('parses Z-machine v3 header fields and produces deterministic IFID/storyId', async () => {
    const z3 = makeZCodeBytes(3, 88, '840726', 0x1a2b);
    const info = await fingerprintStory(z3);

    expect(info.format).toBe('zcode');
    expect(info.zVersion).toBe(3);
    expect(info.release).toBe(88);
    expect(info.serial).toBe('840726');
    expect(info.checksum).toBe(0x1a2b);
    expect(info.ifid).toBe('ZCODE-88-840726-1A2B');
    expect(info.storyId).toMatch(/^zcode-88-840726-1a2b-[a-f0-9]{12}$/);
  });

  it('extracts ZCOD and IFmd chunks from a Blorb container', async () => {
    const z5 = makeZCodeBytes(5, 12, '990101', 0xabcd);
    const xml = new TextEncoder().encode('<ifindex><story><identification><ifid>ZCODE-12-990101-ABCD</ifid></identification></story></ifindex>');
    const xmlPad = xml.length % 2;

    const totalLen = 12 + 8 + z5.length + 8 + xml.length + xmlPad;
    const blorb = new Uint8Array(totalLen);
    const enc = new TextEncoder();

    blorb.set(enc.encode('FORM'), 0);
    const formSize = totalLen - 8;
    blorb[4] = (formSize >>> 24) & 0xff;
    blorb[5] = (formSize >>> 16) & 0xff;
    blorb[6] = (formSize >>> 8) & 0xff;
    blorb[7] = formSize & 0xff;
    blorb.set(enc.encode('IFRS'), 8);

    // ZCOD chunk
    blorb.set(enc.encode('ZCOD'), 12);
    blorb[16] = (z5.length >>> 24) & 0xff;
    blorb[17] = (z5.length >>> 16) & 0xff;
    blorb[18] = (z5.length >>> 8) & 0xff;
    blorb[19] = z5.length & 0xff;
    blorb.set(z5, 20);

    // IFmd chunk
    const mdOff = 20 + z5.length;
    blorb.set(enc.encode('IFmd'), mdOff);
    blorb[mdOff + 4] = (xml.length >>> 24) & 0xff;
    blorb[mdOff + 5] = (xml.length >>> 16) & 0xff;
    blorb[mdOff + 6] = (xml.length >>> 8) & 0xff;
    blorb[mdOff + 7] = xml.length & 0xff;
    blorb.set(xml, mdOff + 8);

    const extracted = extractZCodeSlice(blorb);
    expect(extracted.format).toBe('zblorb');
    expect(extracted.ifid).toBe('ZCODE-12-990101-ABCD');
    expect(extracted.zBytes?.[0]).toBe(5);

    const info = await fingerprintStory(blorb);
    expect(info.format).toBe('zblorb');
    expect(info.zVersion).toBe(5);
    expect(info.ifid).toBe('ZCODE-12-990101-ABCD');
  });
});

// Minimal zip read/write. Writes "stored" (uncompressed) entries; reads stored and deflated ones.
(function (root) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // files: [{ name, data: string | Uint8Array }] -> Uint8Array
  function zip(files) {
    const enc = new TextEncoder();
    const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
    const UTF8_NAMES = 0x0800;
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
      const name = enc.encode(file.name);
      const data = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, UTF8_NAMES, true);
      lv.setUint16(12, DOS_DATE, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);

      const entry = new Uint8Array(46 + name.length);
      const cv = new DataView(entry.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, UTF8_NAMES, true);
      cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      entry.set(name, 46);

      chunks.push(local, data);
      central.push(entry);
      offset += local.length + data.length;
    }
    const centralSize = central.reduce((n, e) => n + e.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
    let pos = 0;
    for (const a of all) { out.set(a, pos); pos += a.length; }
    return out;
  }

  // Uint8Array -> Map(name -> Uint8Array)
  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xFFFF); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file');

    const dec = new TextDecoder();
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip file');
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const skip = nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
      const localAt = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + skip;

      const start = localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
      const raw = bytes.subarray(start, start + size);
      if (method === 0) {
        files.set(name, raw);
      } else if (method === 8) {
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
      } else {
        throw new Error('Unsupported zip compression');
      }
    }
    return files;
  }

  const api = { zip, unzip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Zip = api;
})(typeof self !== 'undefined' ? self : this);

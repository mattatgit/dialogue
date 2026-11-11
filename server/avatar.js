// Profile pictures are normalized to PNG by the client. Validate and retain
// only bounded image data; no SVG, original metadata or executable uploads.
const { inflateSync } = require('node:zlib');
const { AccountError } = require('./accounts.js');
const SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
const table = Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const b of bytes) value = table[(value ^ b) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function avatarPNG(value) {
  const fail = () => { throw new AccountError(400, 'Choose a PNG, JPEG or WebP image using the avatar upload.'); };
  if (typeof value !== 'string' || !value.length || value.length > 350000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return fail();
  const png = Buffer.from(value, 'base64');
  if (png.length > 256 * 1024 || !png.subarray(0,8).equals(SIGNATURE)) return fail();
  const retained = [SIGNATURE], compressed = [];
  let offset=8, header, ended=false;
  while (offset + 12 <= png.length) {
    const length=png.readUInt32BE(offset), end=offset+12+length;
    if (end > png.length) return fail();
    const kind=png.toString('ascii',offset+4,offset+8), bytes=png.subarray(offset+8,end-4);
    if (!/^[A-Za-z]{4}$/.test(kind) || crc(png.subarray(offset+4,end-4)) !== png.readUInt32BE(end-4)) return fail();
    if (!header && kind !== 'IHDR') return fail();
    if (kind === 'IHDR') {
      if (header || length !== 13) return fail();
      const width=bytes.readUInt32BE(0), height=bytes.readUInt32BE(4), color=bytes[9];
      if (!width || !height || width>512 || height>512 || bytes[8]!==8 || ![2,6].includes(color) || bytes[10] || bytes[11] || bytes[12]) return fail();
      header={width,height,channels:color===6 ? 4 : 3};
    } else if (kind === 'IDAT') compressed.push(bytes);
    else if (kind === 'IEND') { if (length || !compressed.length || end !== png.length) return fail(); ended=true; }
    else if (kind[0] === kind[0].toUpperCase()) return fail();
    if (['IHDR','IDAT','IEND'].includes(kind)) retained.push(png.subarray(offset,end));
    offset=end;
    if (ended) break;
  }
  if (!ended) return fail();
  const stride=header.width*header.channels+1, expected=stride*header.height;
  let pixels;
  try { pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1}); } catch { return fail(); }
  if (pixels.length !== expected) return fail();
  for (let y=0;y<header.height;y++) if (pixels[y*stride]>4) return fail();
  return Buffer.concat(retained);
}
module.exports={avatarPNG};

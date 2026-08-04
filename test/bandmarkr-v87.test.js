'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function decodePng(file) {
  const data = fs.readFileSync(path.join(root, file));
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${file} has a valid PNG signature`);

  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  let sawIend = false;

  while (offset < data.length) {
    assert.ok(offset + 12 <= data.length, `${file} has a complete PNG chunk header`);
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8);
    const end = offset + 12 + length;
    assert.ok(end <= data.length, `${file} has a complete ${type.toString('ascii')} chunk`);
    const payload = data.subarray(offset + 8, offset + 8 + length);
    const chunkType = type.toString('ascii');

    if (chunkType === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      bitDepth = payload[8];
      colorType = payload[9];
      interlace = payload[12];
    } else if (chunkType === 'IDAT') {
      idat.push(payload);
    } else if (chunkType === 'IEND') {
      sawIend = true;
      assert.equal(end, data.length, `${file} has no trailing bytes after IEND`);
    }
    offset = end;
  }

  assert.equal(sawIend, true, `${file} contains IEND`);
  assert.equal(bitDepth, 8, `${file} uses 8-bit channels`);
  assert.ok(colorType === 2 || colorType === 6, `${file} uses RGB or RGBA pixels`);
  assert.equal(interlace, 0, `${file} is non-interlaced`);

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(inflated.length, height * (stride + 1), `${file} fully inflates to the expected pixel data length`);

  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++];
    assert.ok(filter >= 0 && filter <= 4, `${file} uses a supported PNG filter`);
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = (raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      }
      pixels[y * stride + x] = value;
    }
    sourceOffset += stride;
  }

  return { width, height, bytesPerPixel, pixels };
}

function pixel(image, x, y) {
  const index = (y * image.width + x) * image.bytesPerPixel;
  const channels = [...image.pixels.subarray(index, index + image.bytesPerPixel)];
  return image.bytesPerPixel === 3 ? [...channels, 255] : channels;
}

function validateIcon(file, expectedSize) {
  const image = decodePng(file);
  assert.deepEqual({ width: image.width, height: image.height }, { width: expectedSize, height: expectedSize });
  const blue = [2, 77, 223, 255];
  const white = [255, 255, 255, 255];
  assert.deepEqual(pixel(image, 0, 0), blue, `${file} keeps the approved blue background`);
  assert.deepEqual(pixel(image, Math.floor(image.width * 0.3), Math.floor(image.height * 0.25)), white, `${file} contains the white bookmark`);
  assert.deepEqual(pixel(image, Math.floor(image.width / 2), Math.floor(image.height * 0.72)), blue, `${file} contains the blue bookmark notch`);

  let blueInside = 0;
  let whiteInside = 0;
  for (let y = Math.floor(image.height * 0.29); y < Math.floor(image.height * 0.58); y += 1) {
    for (let x = Math.floor(image.width * 0.3); x < Math.floor(image.width * 0.7); x += 1) {
      const value = pixel(image, x, y);
      if (value.every((channel, index) => channel === blue[index])) blueInside += 1;
      if (value.every((channel, index) => channel === white[index])) whiteInside += 1;
    }
  }
  assert.ok(blueInside > expectedSize, `${file} contains visible blue BM details`);
  assert.ok(whiteInside > expectedSize, `${file} preserves white space around BM`);
}

test('v87 exposes the approved deterministic BANDMARKR identity without changing internal storage identifiers', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.json'));
  const css = read('bandmarkrV87.css');
  const wordmark = read('icons/bandmarkr-wordmark.svg');
  const version = read('version.js');
  const serviceWorker = read('service-worker.js');

  assert.match(html, /<title>BANDMARKR<\/title>/);
  assert.match(html, /apple-mobile-web-app-title" content="BANDMARKR"/);
  assert.match(html, /brand-wordmark" src="icons\/bandmarkr-wordmark\.svg" alt="BANDMARKR"/);
  assert.doesNotMatch(html, />THE LIVE VAULT</);
  assert.equal(manifest.name, 'BANDMARKR');
  assert.equal(manifest.short_name, 'BANDMARKR');
  assert.match(css, /--bandmarkr-blue:\s*#024ddf/);
  assert.doesNotMatch(css, /font-family|scaleX/);
  assert.match(wordmark, /<title id="title">BANDMARKR<\/title>/);
  assert.match(wordmark, /viewBox="0 350 5845 820"/);
  assert.equal((wordmark.match(/<path /g) || []).length, 9);
  assert.doesNotMatch(wordmark, /<text\b|font-family/);
  assert.match(version, /APP_VERSION = 'v87'/);
  assert.match(serviceWorker, /CACHE_NAME_LITERAL = 'v87'/);
  assert.match(serviceWorker, /concert-tracker-shell-/);
  assert.match(serviceWorker, /bandmarkrV87\.css/);
  assert.match(serviceWorker, /icons\/bandmarkr-wordmark\.svg/);

  validateIcon('icons/icon-192.png', 192);
  validateIcon('icons/icon-192-maskable.png', 192);
  validateIcon('icons/icon-512.png', 512);
  validateIcon('icons/icon-512-maskable.png', 512);
});

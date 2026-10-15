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
  let palette;
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
    } else if (chunkType === 'PLTE') {
      assert.equal(payload.length % 3, 0, `${file} has complete RGB palette entries`);
      palette = payload;
    } else if (chunkType === 'IDAT') {
      idat.push(payload);
    } else if (chunkType === 'IEND') {
      sawIend = true;
      assert.equal(end, data.length, `${file} has no trailing bytes after IEND`);
    }
    offset = end;
  }

  assert.equal(sawIend, true, `${file} contains IEND`);
  assert.equal(bitDepth, 8, `${file} uses 8-bit channels or palette indexes`);
  assert.ok(colorType === 2 || colorType === 3 || colorType === 6, `${file} uses RGB, indexed RGB, or RGBA pixels`);
  if (colorType === 3) assert.ok(palette && palette.length >= 6, `${file} contains its indexed RGB palette`);
  assert.equal(interlace, 0, `${file} is non-interlaced`);

  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
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

  return { width, height, colorType, bytesPerPixel, palette, pixels };
}

function pixel(image, x, y) {
  const index = (y * image.width + x) * image.bytesPerPixel;
  if (image.colorType === 3) {
    const paletteIndex = image.pixels[index];
    const paletteOffset = paletteIndex * 3;
    assert.ok(paletteOffset + 2 < image.palette.length, 'indexed PNG pixel points to a valid palette entry');
    return [image.palette[paletteOffset], image.palette[paletteOffset + 1], image.palette[paletteOffset + 2], 255];
  }
  const channels = [...image.pixels.subarray(index, index + image.bytesPerPixel)];
  return image.bytesPerPixel === 3 ? [...channels, 255] : channels;
}

function validateIcon(file, expectedSize) {
  const image = decodePng(file);
  assert.deepEqual({ width: image.width, height: image.height }, { width: expectedSize, height: expectedSize });
  const topLeft = pixel(image, 0, 0);
  const bottomRight = pixel(image, image.width - 1, image.height - 1);
  const white = [255, 255, 255, 255];
  for (const [corner, color] of [['top-left', topLeft], ['bottom-right', bottomRight]]) {
    assert.equal(color.length, 4, `${file} ${corner} corner is opaque`);
    assert.ok(color[2] > color[0] && color[2] > color[1], `${file} ${corner} corner remains blue-toned`);
  }
  assert.notDeepEqual(topLeft, bottomRight, `${file} uses a tonal gradient rather than a flat background`);

  const whitePoints = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (pixel(image, x, y).every((channel, index) => channel === white[index])) whitePoints.push([x, y]);
    }
  }
  assert.ok(whitePoints.length > expectedSize * expectedSize * 0.04, `${file} contains a visible white waveform`);
  const xs = whitePoints.map(([x]) => x);
  const ys = whitePoints.map(([, y]) => y);
  const bounds = {
    left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
  };
  const widthRatio = (bounds.right - bounds.left + 1) / image.width;
  const heightRatio = (bounds.bottom - bounds.top + 1) / image.height;
  assert.ok(widthRatio >= 0.68 && widthRatio <= 0.74, `${file} waveform stays compact and readable in width`);
  assert.ok(heightRatio >= 0.56 && heightRatio <= 0.63, `${file} waveform stays compact and readable in height`);
  assert.ok(Math.abs((bounds.left + bounds.right) / 2 - image.width / 2) <= 1, `${file} waveform is horizontally centered`);

  const centerY = Math.floor(image.height * 0.57);
  let whiteRuns = 0;
  let insideRun = false;
  for (let x = bounds.left; x <= bounds.right; x += 1) {
    const isWhite = pixel(image, x, centerY).every((channel, index) => channel === white[index]);
    if (isWhite && !insideRun) whiteRuns += 1;
    insideRun = isWhite;
  }
  assert.equal(whiteRuns, 5, `${file} contains five distinct waveform bars`);
  assert.deepEqual(pixel(image, Math.floor(image.width / 2), Math.floor(image.height / 2)), white, `${file} has a bright center waveform bar`);
}

test('Bandmarkr keeps its wordmark and uses a CTA-toned waveform for the installed icon', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.json'));
  const css = read('bandmarkrV87.css');
  const wordmark = read('icons/bandmarkr-wordmark.svg');
  const appIcon = read('icons/bandmarkr-app-icon.svg');
  const version = read('version.js');
  const serviceWorker = read('service-worker.js');

  assert.match(html, /<title>Bandmarkr<\/title>/);
  assert.match(html, /application-name" content="Bandmarkr"/);
  assert.match(html, /apple-mobile-web-app-title" content="Bandmarkr"/);
  assert.match(html, /brand-wordmark" src="icons\/bandmarkr-wordmark\.svg" alt="BANDMARKR"/);
  assert.equal(manifest.name, 'Bandmarkr');
  assert.equal(manifest.short_name, 'Bandmarkr');
  assert.ok(manifest.icons.every(({ src }) => src.endsWith('?v=197')), 'manifest icon URLs refresh for v197');
  assert.match(css, /--bandmarkr-blue:\s*#024ddf/);
  assert.match(wordmark, /<title id="title">BANDMARKR<\/title>/);
  assert.equal((wordmark.match(/<path /g) || []).length, 9);
  assert.match(appIcon, /d="M5 16v-4M9 18V8M13 16V5M17 18v-8M21 15v-5"/);
  assert.match(appIcon, /id="cta-highlight"/);
  assert.match(version, /APP_VERSION = 'v199'/);
  assert.match(serviceWorker, /CACHE_NAME_LITERAL = 'v199'/);
  assert.match(serviceWorker, /concert-tracker-shell-/);
  assert.match(serviceWorker, /icons\/bandmarkr-wordmark\.svg/);

  validateIcon('icons/icon-192.png', 192);
  validateIcon('icons/icon-192-maskable.png', 192);
  validateIcon('icons/icon-512.png', 512);
  validateIcon('icons/icon-512-maskable.png', 512);
});

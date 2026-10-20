// Regenerates the icons in app/public/ from the SVG sources in this folder.
// From the repo root:  npm i --no-save @resvg/resvg-js && node assets/icons/make-icons.mjs
// (RESVG_PATH can point at an existing @resvg/resvg-js install instead.)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { Resvg } = await import(process.env.RESVG_PATH || '@resvg/resvg-js');
const src = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = (p) => fileURLToPath(new URL('../../app/public/' + p, import.meta.url));
const render = (svg, size) =>
  new Resvg(readFileSync(src(svg)), { fitTo: { mode: 'width', value: size } }).render().asPng();

writeFileSync(out('favicon.svg'), readFileSync(src('favicon.svg')));
writeFileSync(out('icon-192.png'), render('icon.svg', 192));
writeFileSync(out('icon-512.png'), render('icon.svg', 512));
writeFileSync(out('icon-maskable-512.png'), render('icon-maskable.svg', 512));
writeFileSync(out('apple-touch-icon.png'), render('icon-maskable.svg', 180));

// favicon.ico: 16, 32 and 48 px PNG images in an ICO container
const sizes = [16, 32, 48];
const images = sizes.map((s) => render('favicon.svg', s));
const head = Buffer.alloc(6 + 16 * images.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(images.length, 4);
let offset = head.length;
images.forEach((img, i) => {
  const o = 6 + 16 * i;
  head.writeUInt8(sizes[i], o);
  head.writeUInt8(sizes[i], o + 1);
  head.writeUInt16LE(1, o + 4);
  head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(img.length, o + 8);
  head.writeUInt32LE(offset, o + 12);
  offset += img.length;
});
writeFileSync(out('favicon.ico'), Buffer.concat([head, ...images]));
console.log('Wrote favicon.svg, favicon.ico, icon-192/512.png, icon-maskable-512.png and apple-touch-icon.png to app/public/');

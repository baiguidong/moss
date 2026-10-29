// Regenerate checked-in icon assets with: node scripts/generate-app-icons.mjs
// Keep Dock, settings previews, web assets and packaged icons on the same artwork.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

if (process.platform !== 'darwin') throw new Error('Regenerate app icons on macOS: ICNS requires the native iconutil encoder.');
const ui = fileURLToPath(new URL('..', import.meta.url));
const build = path.join(ui, 'build');
const publicBuild = path.join(ui, 'public/build');
const iconset = path.join(build, 'icon.iconset');
await fs.mkdir(publicBuild, { recursive: true });
await fs.mkdir(iconset, { recursive: true });
const svg = await fs.readFile(path.join(build, 'icon.svg'));
const master = await sharp(svg).png().toBuffer();
const sizes = [16, 32, 48, 64, 128, 180, 256, 512, 1024];
const images = new Map();
for (const size of sizes) images.set(size, await sharp(master).resize(size, size).png().toBuffer());

// Render variants once, rather than using different color transforms in Chromium
// and nativeImage. Alpha, shadows and silhouette remain identical in every variant.
for (const variant of ['default', 'graphite', 'inverted']) {
  let png = master;
  if (variant !== 'default') {
    const artwork = svg.toString().replace(/#[0-9a-f]{6}\b/gi, color => {
      const [red, green, blue] = color.slice(1).match(/../g).map(channel => parseInt(channel, 16));
      let gray = Math.round(red * .2126 + green * .7152 + blue * .0722);
      if (variant === 'inverted') gray = 255 - gray;
      return `#${gray.toString(16).padStart(2, '0').repeat(3)}`;
    });
    // Transform the artwork before compositing so the shadow stays black.
    png = await sharp(Buffer.from(artwork)).png().toBuffer();
  }
  const name = variant === 'default' ? 'icon.png' : `icon-${variant}.png`;
  await fs.writeFile(path.join(build, name), png);
  await fs.writeFile(path.join(publicBuild, name), png);
}

// Include every standard and Retina representation. Apple's native encoder also
// writes the legacy small-icon color/mask chunks required by Finder.
const representations = [
  [16, 'icon_16x16'], [32, 'icon_16x16@2x'],
  [32, 'icon_32x32'], [64, 'icon_32x32@2x'],
  [128, 'icon_128x128'], [256, 'icon_128x128@2x'],
  [256, 'icon_256x256'], [512, 'icon_256x256@2x'],
  [512, 'icon_512x512'], [1024, 'icon_512x512@2x'],
];
for (const [size, name] of representations) await fs.writeFile(path.join(iconset, `${name}.png`), images.get(size));
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(build, 'icon.icns')]);

// Modern Windows ICO supports embedded PNG images at each resolution.
function ico(iconSizes) {
  const header = Buffer.alloc(6 + iconSizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(iconSizes.length, 4);
  let offset = header.length;
  for (const [index, size] of iconSizes.entries()) {
    const entry = 6 + index * 16, png = images.get(size);
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  }
  return Buffer.concat([header, ...iconSizes.map(size => images.get(size))]);
}
await fs.writeFile(path.join(build, 'icon.ico'), ico([16, 32, 48, 64, 128, 256]));
await fs.writeFile(path.join(build, 'favicon.ico'), ico([16, 32, 48, 64, 128]));
for (const size of [16, 32, 48, 64, 128]) await fs.writeFile(path.join(build, `favicon-${size}.png`), images.get(size));
await fs.writeFile(path.join(build, 'apple-touch-icon.png'), images.get(180));
console.log('Generated Moss icons from build/icon.svg.');

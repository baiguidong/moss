import fs from 'node:fs';
import path from 'node:path';

// Use the same transparent, padded artwork as the settings previews and ICNS.
export function createDockAppearance({ app, nativeImage, uiRoot, platform = process.platform }) {
  const icons = new Map();
  let current;
  return function applyDockIcon(variant = 'default') {
    if (platform !== 'darwin' || !app.dock || !app.isReady() || current === variant) return;
    if (!icons.has(variant)) {
      const filename = variant === 'graphite' || variant === 'inverted' ? `icon-${variant}.png` : 'icon.png';
      const iconPath = ['build', 'dist/renderer/build', 'public/build', 'dist/build'].map(directory => path.join(uiRoot, directory, filename)).find(file => fs.existsSync(file));
      if (!iconPath) throw new Error('Moss Dock 图标资源缺失。');
      const original = nativeImage.createFromPath(iconPath);
      if (original.isEmpty()) throw new Error('Moss Dock 图标无法读取。');
      icons.set(variant, original);
    }
    app.dock.setIcon(icons.get(variant));
    current = variant;
  };
}

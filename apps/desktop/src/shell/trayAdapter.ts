import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import type { TrayState } from '@homestream/shared';
import type { TrayAction, TrayMenuItem, TrayView } from '../trayModel.js';

/** The 16, 20 and 24 px files Windows picks from at 100 %, 125 % and 150 % display scaling. */
const SCALES: ReadonlyArray<readonly [size: number, scaleFactor: number]> = [
  [16, 1],
  [20, 1.25],
  [24, 1.5],
];

export interface TrayHandlers {
  onAction(action: TrayAction): void;
}

export class TrayAdapter {
  private readonly tray: Tray;
  private readonly icons = new Map<TrayState, NativeImage>();
  private readonly dots = new Map<TrayState, NativeImage>();

  constructor(
    private readonly assetsDir: string,
    private readonly handlers: TrayHandlers,
    initial: TrayView,
  ) {
    this.tray = new Tray(this.iconFor(initial.state));
    this.tray.on('double-click', () => handlers.onAction('open'));
    this.update(initial);
  }

  update(view: TrayView): void {
    if (this.tray.isDestroyed()) return;
    this.tray.setImage(this.iconFor(view.state));
    this.tray.setToolTip(view.tooltip);
    this.tray.setContextMenu(Menu.buildFromTemplate(view.items.map((item) => this.template(item))));
  }

  destroy(): void {
    this.tray.destroy();
  }

  private template(item: TrayMenuItem): MenuItemConstructorOptions {
    if (item.separator) return { type: 'separator' };
    const { id } = item;
    const base: MenuItemConstructorOptions = {
      label: item.label,
      enabled: item.enabled,
      ...(item.dot ? { icon: this.dotFor(item.dot) } : {}),
      ...(id ? { click: () => this.handlers.onAction(id) } : {}),
    };
    return item.checked === undefined ? base : { ...base, type: 'checkbox', checked: item.checked };
  }

  private iconFor(state: TrayState): NativeImage {
    let image = this.icons.get(state);
    if (!image) {
      image = nativeImage.createEmpty();
      for (const [size, scaleFactor] of SCALES) {
        const buffer = readFileSync(path.join(this.assetsDir, 'tray', `${state}-${size}.png`));
        image.addRepresentation({ scaleFactor, width: size, height: size, buffer });
      }
      this.icons.set(state, image);
    }
    return image;
  }

  private dotFor(state: TrayState): NativeImage {
    let image = this.dots.get(state);
    if (!image) {
      image = nativeImage.createFromPath(path.join(this.assetsDir, 'tray', `dot-${state}.png`));
      this.dots.set(state, image);
    }
    return image;
  }
}

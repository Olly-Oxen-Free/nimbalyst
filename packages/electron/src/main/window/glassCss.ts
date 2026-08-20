/**
 * Live CSS injection for the main workspace window's "glass" chrome, in the
 * spirit of Discord-mod custom-CSS loaders (Vencord/Legcord): a plain CSS
 * file the user edits directly, re-injected on save, no rebuild or
 * repackage. Only the window's own transparency (`transparent: true` +
 * the `enable-transparent-visuals` Chromium switch, both set unconditionally
 * for this window in WindowManager.ts/bootstrap.ts) is unavoidably native --
 * that's a real Electron/Chromium constraint (the compositor surface is
 * created once, at window-creation time; no page-level CSS can retroactively
 * punch alpha through an opaque surface). Everything about WHICH elements go
 * translucent and by how much belongs here instead.
 *
 * File lives at <userData>/nimbalyst-glass.css. Absent by default -- glass
 * is opt-in by creating the file, not a hardcoded app behavior.
 */

import { app } from 'electron';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'fs';
import { join } from 'path';
import type { BrowserWindow } from 'electron';

function glassCssPath(): string {
    return join(app.getPath('userData'), 'nimbalyst-glass.css');
}

/**
 * Inject (or re-inject) the glass CSS file into `window`, and watch it for
 * edits so changes apply live without reloading the window. Call once per
 * window, after `did-finish-load`. No-ops silently if the file doesn't
 * exist -- glass is opt-in.
 */
export function watchAndInjectGlassCss(window: BrowserWindow): void {
    const path = glassCssPath();
    let insertedKey: string | null = null;

    const apply = async () => {
        if (window.isDestroyed()) return;
        if (!existsSync(path)) return;

        let css: string;
        try {
            css = readFileSync(path, 'utf-8');
        } catch (err) {
            console.warn('[glassCss] failed to read', path, err);
            return;
        }

        try {
            if (insertedKey) {
                await window.webContents.removeInsertedCSS(insertedKey);
            }
            insertedKey = await window.webContents.insertCSS(css);
            console.log('[glassCss] injected', path);
        } catch (err) {
            console.warn('[glassCss] failed to inject', path, err);
        }
    };

    void apply();

    // fs.watch on a single user-owned config file (not a busy shared
    // directory like $XDG_RUNTIME_DIR) is fine here, but watchFile's polling
    // is simpler to reason about and immune to the same watcher-dies-on-
    // unrelated-error failure mode hit elsewhere in this stack.
    watchFile(path, { interval: 500 }, () => void apply());

    window.once('closed', () => unwatchFile(path));
}

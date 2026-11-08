'use strict';
const path = require('node:path');
const { createOverlayLibrary } = require('./overlays');

module.exports = function registerOverlayIpc({ app, ipcMain, dialog, shell, window, bridge = () => null, language = () => 'en' }) {
  const nativeDialog = dialog, zh = require('./shared/overlay-zh');
  const localized = options => language().startsWith('zh') ? zh.dialog(options) : options;
  dialog = {
    showOpenDialog: (win, options) => nativeDialog.showOpenDialog(win, localized(options)),
    showMessageBox: (win, options) => nativeDialog.showMessageBox(win, localized(options))
  };
  const appRoot = path.resolve(__dirname, '..');
  // Installed, the built add-on rides along as an extra resource; from source it
  // is whatever scripts/build-overlay.ps1 last produced.
  const builtin = () => (app.isPackaged
    ? path.join(process.resourcesPath, 'overlay', 'dlss5-lab-overlay.addon64')
    : path.join(appRoot, 'dist/overlay/dlss5-lab-overlay.addon64'));
  // Never let an overlay be installed over the app's own directory.
  const forbidden = () => [appRoot, app.isPackaged ? path.dirname(app.getPath('exe')) : appRoot];
  const library = () => createOverlayLibrary(path.join(app.getPath('userData'), 'overlay-library'),
    builtin(), forbidden());
  const handle = (name, fn) => ipcMain.handle(`overlay-${name}`, async (_event, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  handle('list', () => library().list());
  // What the panel in the game is waiting for, said on the Overlay page:
  // whether the service is up at all, and whether a game is attached.
  handle('bridge', () => {
    const live = bridge();
    const state = live ? live.state() : { listening: false, connected: false, game: false };
    // The service can be listening perfectly while the add-on the game has to
    // load is not there at all - antivirus takes it, and nothing said so.
    // Poll its PE headers; the install path verifies the full file.
    const entry = library().builtinStatus();
    return { ...state, addon:entry.ready, addonFile:entry.file };
  });
  handle('preferences',()=>require('./overlay-preferences').read(app.getPath('userData')));
  handle('save-preferences',patch=>require('./overlay-preferences').save(app.getPath('userData'),patch));
  handle('add', async () => {
    const picked = await dialog.showOpenDialog(window(), { title: 'Add a custom ReShade overlay', properties: ['openFile'], filters: [{ name: 'ReShade native add-ons', extensions: ['addon64', 'addon32'] }] });
    if (picked.canceled) return null;
    const confirm = await dialog.showMessageBox(window(), { type: 'warning', title: 'Native add-on — trusted developers only',
      message: 'This file contains native code. A ReShade add-on can access your files when loaded by a game.',
      detail: 'Adding it here only stores a copy; it is not executed here. A checksum does not certify that the file is safe.',
      buttons: ['Cancel', 'Add trusted file'], defaultId: 0, cancelId: 0 });
    return confirm.response === 1 ? library().add(picked.filePaths[0]) : null;
  });
  handle('remove', async id => {
    if (id === 'builtin') throw Error('The built-in overlay cannot be deleted.');
    const entry = library().list().overlays.find(entry => entry.id === id);
    if (!entry) throw Error('Invalid overlay ID.');
    const confirm = await dialog.showMessageBox(window(), { type: 'question', message: `Remove ${entry.name}?`, detail: 'Your original imported file is kept.', buttons: ['Cancel', 'Remove'], defaultId: 0, cancelId: 0 });
    if (confirm.response !== 1) return null;
    library().remove(id);
    return true;
  });
  handle('install', async id => {
    const entry = library().resolve(id);
    if (!entry.ready) throw Error('Build the experimental add-on first (see Developer files).');
    const picked = await dialog.showOpenDialog(window(), { title: 'Select a CLOSED offline test game with ReShade add-on support', properties: ['openFile'], filters: [{ name: 'Windows game executable', extensions: ['exe'] }] });
    if (picked.canceled) return null;
    const panelDetail = entry.builtin
      ? 'Keep NeuralFrame open to use the built-in panel. It connects to supported RenoDX and Feeder builds. RenoDX saves the settings you change.'
      : 'This external add-on provides its own controls.';
    const confirm = await dialog.showMessageBox(window(), { type: 'warning', title: 'Overlay test — not a DLSS installation',
      message: 'Confirm that the game is closed and uses ReShade with add-on support.',
      detail: `${picked.filePaths[0]}\n\nOnly a uniquely named overlay add-on is copied next to this executable. No existing DLLs or configuration files are replaced by installation. No Vulkan registry changes. Avoid online / anti-cheat games.\n\n${panelDetail}`,
      buttons: ['Cancel', 'Install test overlay'], defaultId: 0, cancelId: 0 });
    if (confirm.response !== 1) return null;
    new (require('./core/component-review').ComponentReview)(app.getPath('userData')).assertUnlockedWithin(path.dirname(picked.filePaths[0]));
    return library().install(id, picked.filePaths[0]);
  });
  handle('uninstall', async id => {
    const installed = library().list().installations.find(record => record.id === id);
    const confirm = await dialog.showMessageBox(window(), { type: 'question', message: 'Is the test game closed?', detail: 'Remove only the unchanged overlay this app copied. Keep ReShade, DLSS, presets, and every original file.', buttons: ['Cancel', 'Remove test overlay'], defaultId: 0, cancelId: 0 });
    if (confirm.response !== 1) return null;
    if (installed) new (require('./core/component-review').ComponentReview)(app.getPath('userData')).assertUnlockedWithin(installed.directory);
    library().uninstall(id);
    return true;
  });
  handle('source', async () => {
    const directory = app.isPackaged ? path.dirname(builtin()) : path.join(appRoot, 'overlay');
    const error = await shell.openPath(directory);
    if (error) throw Error(error);
  });
};

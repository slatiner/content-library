// File version of the storage adapter (see ./index.js): media-archive-data.json
// in a folder the user connects through the File System Access API. The folder
// handle is remembered in IndexedDB; the browser asks for permission again on
// each new launch.
import { idbGet, idbSet, idbDelete } from './idb.js';

const DATA_FILENAME = 'media-archive-data.json';
const HANDLE_KEY = 'dataDirHandle';

const MSG = {
  connected: `Connected folder — using ${DATA_FILENAME}`,
  notFound: `That folder couldn't be found — it may have been moved or renamed. Click "Change folder" to pick its new location.`,
  denied: `The browser has blocked access to your folder. Click "Change folder" and choose it again.`,
  notGranted: `Access to the folder wasn't granted. Click "Change folder" and choose it again.`,
  reconnect: `Reconnect to your folder to continue (the browser asks for this each time you open the app).`,
  unsupported: "This browser doesn't support direct folder access — use Chrome, Brave, or Edge. You can still use Export / Import JSON manually.",
};

export function createFileStorage(setStatus) {
  let dirHandle = null;
  let fileHandle = null;
  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window && window.isSecureContext;

  async function readEntries() {
    const text = await (await fileHandle.getFile()).text();
    return text.trim() ? JSON.parse(text) : [];
  }

  async function writeAll(entries) {
    if (!fileHandle) return;
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(entries, null, 2));
    await writable.close();
  }

  async function openDataFile() {
    fileHandle = await dirHandle.getFileHandle(DATA_FILENAME, { create: true });
    const entries = await readEntries();
    setStatus('ok', MSG.connected);
    return entries;
  }

  async function forgetMissingFolder() {
    await idbDelete(HANDLE_KEY).catch(() => {});
    dirHandle = null;
    setStatus('warn', MSG.notFound);
  }

  return {
    kind: 'file',
    supported,

    // Restore the remembered folder if the browser still allows access.
    // Returns the entries when connected, otherwise null (status says why).
    async init() {
      if (!supported) { setStatus('unsupported', MSG.unsupported); return null; }
      let handle;
      try { handle = await idbGet(HANDLE_KEY); } catch (e) { handle = null; }
      if (!handle) { setStatus('none', 'No folder connected yet.'); return null; }
      dirHandle = handle;
      try {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') return await openDataFile();
        if (perm === 'denied') { setStatus('warn', MSG.denied); return null; }
      } catch (e) {
        if (e && e.name === 'NotFoundError') { await forgetMissingFolder(); return null; }
        /* other errors: fall through to reconnect */
      }
      setStatus('warn', MSG.reconnect);
      return null;
    },

    // User action: pick a folder. Returns entries, or null if cancelled.
    async connect() {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        dirHandle = handle;
        await idbSet(HANDLE_KEY, handle);
        return await openDataFile();
      } catch (e) {
        if (e && e.name !== 'AbortError') alert('Could not connect the folder: ' + (e.message || e));
        return null;
      }
    },

    // User action: grant access to the remembered folder again.
    async reconnect() {
      // No usable saved folder (e.g. it was moved): Reconnect can't help, so go straight to choosing the folder again.
      if (!dirHandle) return this.connect();
      try {
        const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') { setStatus('warn', MSG.notGranted); return null; }
        return await openDataFile();
      } catch (e) {
        if (e && e.name === 'NotFoundError') { await forgetMissingFolder(); return null; }
        alert('Reconnect failed: ' + (e.message || e));
        return null;
      }
    },

    // The file version rewrites the whole file on every change.
    saveEntry: (entry, all) => writeAll(all),
    deleteEntry: (id, all) => writeAll(all),
    replaceAll: (all) => writeAll(all),

    // Read secrets.json from the connected folder. Returns the parsed object or null.
    async readSecrets() {
      if (!dirHandle) return null;
      try {
        const fh = await dirHandle.getFileHandle('secrets.json');
        return JSON.parse(await (await fh.getFile()).text());
      } catch (e) { return null; }
    },
  };
}

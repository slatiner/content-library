// The storage adapter (#41). All reads and writes of the library go through one
// of these, so the backend can change (file -> Supabase -> PocketBase) without
// touching the views.
//
// An adapter is created with setStatus(state, text), which it calls to report
// the connection: state is 'checking' | 'none' | 'ok' | 'warn' | 'unsupported'.
// It provides:
//   init()                  restore a previous connection; entries[] or null
//   connect()               user action to connect; entries[] or null
//   reconnect()             user action to restore access; entries[] or null
//   saveEntry(entry, all)   create or update one entry (all = the full list after the change)
//   deleteEntry(id, all)    delete one entry (all = the full list after the change)
//   replaceAll(all)         replace the whole library (Export/Import "Replace all")
//   readSecrets()           secrets.json from the data folder, or null
//
// The file version passes `all` straight to disk. A row-based backend (#15)
// uses entry/id and ignores `all`.
export { createFileStorage } from './fileStorage.js';

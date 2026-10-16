// The storage adapter (#41). All reads and writes of the library go through one
// of these, so the backend can change (file -> Supabase -> PocketBase) without
// touching the views.
//
// An adapter is created with setStatus(state, text, account, profile), which it
// calls to report the connection: state is 'checking' | 'none' | 'signedOut' |
// 'needsInvite' | 'ok' | 'warn' | 'unsupported'; account is the signed-in email,
// if any; profile is { name, avatarUrl, isAdmin } from the sign-in provider and
// the account's membership, or null.
// kind is 'file' or 'supabase'.
// It provides:
//   init()                  restore a previous connection; entries[] or null
//   connect()               user action to connect (pick a folder / sign in); entries[] or null
//   reconnect()             user action to restore access or retry; entries[] or null
//   signOut()               (supabase only)
//   redeemInvite(code)      (supabase only) join with an invite code; entries[] or null
//   createInvite()          (supabase only, admins) { code, expiresAt }
//   listInvites()           (supabase only, admins) recent invites
//   saveEntry(entry, all)   create or update one entry (all = the full list after the change)
//   deleteEntry(id, all)    delete one entry (all = the full list after the change)
//   replaceAll(all)         replace the whole library (Export/Import "Replace all")
//   readSecrets()           secrets.json from the data folder, or null
//   llmEndpoint()           (supabase only) { url, headers } of the assistant's
//                           Groq proxy for the signed-in user, or null
//
// The file version passes `all` straight to disk. A row-based backend (#15)
// uses entry/id and ignores `all`.
export { createFileStorage } from './fileStorage.js';
export { createSupabaseStorage } from './supabaseStorage.js';

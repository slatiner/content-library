// Supabase version of the storage adapter (see ./index.js). Signs in with
// Google; each entry is one row, so saves touch only the changed entry. Row-level
// security limits every query to the signed-in user's rows.
import { createClient } from '@supabase/supabase-js';
import { entryToRow, rowToEntry } from './rows.js';

const PAGE = 1000; // PostgREST's default maximum rows per request

export function createSupabaseStorage(setStatus, { url, key, client } = {}) {
  const sb = client || createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
  let user = null;

  function fail(what, error) {
    throw new Error(`${what}: ${(error && error.message) || error}`);
  }

  async function loadAll() {
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('entries').select('*').order('date_added').range(from, from + PAGE - 1);
      if (error) fail('Could not load your library', error);
      all.push(...data);
      if (data.length < PAGE) break;
    }
    return all.map(rowToEntry);
  }

  // Google's name and picture come with the default sign-in scopes.
  function profile() {
    const m = (user && user.user_metadata) || {};
    return { name: m.full_name || m.name || '', avatarUrl: m.avatar_url || m.picture || '' };
  }

  async function startSession(session) {
    user = session.user;
    try {
      const entries = await loadAll();
      setStatus('ok', `Signed in as ${user.email}`, user.email, profile());
      return entries;
    } catch (e) {
      setStatus('warn', `${e.message}. Check your connection, then click Retry.`, user.email, profile());
      return null;
    }
  }

  return {
    kind: 'supabase',
    supported: true,

    async init() {
      const { data, error } = await sb.auth.getSession();
      if (error) { setStatus('warn', `Sign-in failed: ${error.message}. Try signing in again.`); return null; }
      if (!data.session) { setStatus('signedOut', 'Sign in to see your library.'); return null; }
      return startSession(data.session);
    },

    // Sign in with Google. The browser leaves the page and comes back signed in.
    async connect() {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (error) setStatus('signedOut', `Could not start Google sign-in: ${error.message}`);
      return null;
    },

    // Retry loading after an error.
    reconnect() { return this.init(); },

    async signOut() {
      await sb.auth.signOut();
      user = null;
      setStatus('signedOut', 'Signed out.');
    },

    async saveEntry(entry) {
      const { error } = await sb.from('entries').upsert(entryToRow(entry, user.id), { onConflict: 'user_id,id' });
      if (error) fail('Could not save', error);
    },

    async deleteEntry(id) {
      const { error } = await sb.from('entries').delete().eq('id', id);
      if (error) fail('Could not delete', error);
    },

    // Make the database match `all`: upsert every entry, then delete the rest.
    // Not atomic; a failure part-way leaves extra rows, never lost ones.
    async replaceAll(all) {
      if (all.length) {
        const { error } = await sb.from('entries').upsert(all.map((e) => entryToRow(e, user.id)), { onConflict: 'user_id,id' });
        if (error) fail('Could not save', error);
      }
      let del = sb.from('entries').delete().eq('user_id', user.id);
      if (all.length) del = del.not('id', 'in', `(${all.map((e) => `"${String(e.id).replace(/"/g, '')}"`).join(',')})`);
      const { error } = await del;
      if (error) fail('Could not remove old entries', error);
    },

    // No data folder online.
    async readSecrets() { return null; },

    // The assistant's Groq proxy (supabase/functions/groq), called with the
    // signed-in user's token. null when signed out.
    async llmEndpoint() {
      const { data } = await sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) return null;
      return { url: `${url}/functions/v1/groq`, headers: { Authorization: `Bearer ${token}`, apikey: key } };
    },
  };
}

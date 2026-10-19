// Supabase version of the storage adapter (see ./index.js). Signs in with
// Google; each entry is one row, so saves touch only the changed entry. Row-level
// security limits every query to the signed-in user's rows. A new account has to
// redeem an invite code before it can read or write anything (#28).
import { createClient } from '@supabase/supabase-js';
import { entryToRow, rowToEntry } from './rows.js';

const PAGE = 1000; // PostgREST's default maximum rows per request

export function createSupabaseStorage(setStatus, { url, key, client } = {}) {
  const sb = client || createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
  let user = null;
  let isAdmin = false;
  let defaultVisibility = 'private';

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
    return { name: m.full_name || m.name || '', avatarUrl: m.avatar_url || m.picture || '', isAdmin, defaultVisibility };
  }

  async function startSession(session) {
    user = session.user;
    try {
      const { data: member, error } = await sb.from('members').select('is_admin, default_visibility').eq('user_id', user.id).maybeSingle();
      if (error) fail('Could not check your account', error);
      if (!member) {
        isAdmin = false;
        setStatus('needsInvite', 'Enter your invite code to finish signing up.', user.email, profile());
        return null;
      }
      isAdmin = member.is_admin;
      defaultVisibility = member.default_visibility;
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
      isAdmin = false;
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

    // Redeem an invite code; on success loads the (empty) library. Throws the
    // database's message ("already used", "expired"...) on failure.
    async redeemInvite(code) {
      const { error } = await sb.rpc('redeem_invite', { p_code: code });
      if (error) throw new Error(error.message);
      const { data } = await sb.auth.getSession();
      return startSession(data.session);
    },

    // Admins only: a new single-use code, as { code, expiresAt }.
    async createInvite() {
      const { data, error } = await sb.rpc('create_invite');
      if (error) fail('Could not create an invite', error);
      return { code: data.code, expiresAt: data.expires_at };
    },

    // Admins only: recent invites, newest first, as { code, createdAt, expiresAt, usedAt }.
    async listInvites() {
      const { data, error } = await sb.from('invites').select('code, created_at, expires_at, used_at')
        .order('created_at', { ascending: false }).limit(20);
      if (error) fail('Could not load invites', error);
      return data.map((r) => ({ code: r.code, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at }));
    },

    // ---- Sharing (#20) ----

    async setDefaultVisibility(level) {
      const { error } = await sb.from('members').update({ default_visibility: level }).eq('user_id', user.id);
      if (error) fail('Could not change your library setting', error);
      defaultVisibility = level;
      setStatus('ok', `Signed in as ${user.email}`, user.email, profile());
    },

    // The secret link token for one entry, or for the library when entryId is null.
    async shareLink(entryId = null) {
      const { data, error } = await sb.rpc('get_share_link', { p_entry_id: entryId });
      if (error) fail('Could not create a share link', error);
      return data;
    },

    // The user's links, as { token, entryId (null = library), createdAt }.
    async listShareLinks() {
      const { data, error } = await sb.from('share_links').select('token, entry_id, created_at').order('created_at');
      if (error) fail('Could not load your share links', error);
      return data.map((r) => ({ token: r.token, entryId: r.entry_id, createdAt: r.created_at }));
    },

    async revokeShareLink(token) {
      const { error } = await sb.from('share_links').delete().eq('token', token);
      if (error) fail('Could not revoke the link', error);
    },

    // What a share link shows; works signed out. { ownerName, entries } or null
    // for an unknown or revoked link. Shared entries have no notes.
    async sharedByLink(token) {
      const { data, error } = await sb.rpc('shared_by_link', { p_token: token });
      if (error) fail('Could not open this link', error);
      if (!data.length) return null;
      return { ownerName: data[0].owner_name, entries: data.map((r) => rowToEntry(r.entry)) };
    },

    // ---- Your data (#29) ----

    // Everything stored for this account, as one object for a JSON download.
    // Notes included; invites only those this account created.
    async exportAccount() {
      const [member, links, invites] = await Promise.all([
        sb.from('members').select('is_admin, joined_at, default_visibility').eq('user_id', user.id).maybeSingle(),
        sb.from('share_links').select('token, entry_id, created_at').order('created_at'),
        sb.from('invites').select('code, created_at, expires_at, used_at').eq('created_by', user.id).order('created_at'),
      ]);
      const failed = [member, links, invites].find((r) => r.error);
      if (failed) fail('Could not export your data', failed.error);
      const m = user.user_metadata || {};
      return {
        exportedAt: new Date().toISOString(),
        account: { email: user.email, name: m.full_name || m.name || '', avatarUrl: m.avatar_url || m.picture || '', createdAt: user.created_at },
        membership: member.data && { isAdmin: member.data.is_admin, joinedAt: member.data.joined_at, defaultVisibility: member.data.default_visibility },
        entries: member.data ? await loadAll() : [],
        shareLinks: links.data.map((r) => ({ token: r.token, entryId: r.entry_id, createdAt: r.created_at })),
        invitesCreated: invites.data.map((r) => ({ code: r.code, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at })),
      };
    },

    // Deletes the account and all its data right away, then signs out. Throws the
    // database's message (e.g. the last admin) on failure.
    async deleteAccount() {
      const { error } = await sb.rpc('delete_my_account');
      if (error) throw new Error(error.message);
      await sb.auth.signOut({ scope: 'local' });
      user = null;
      isAdmin = false;
      setStatus('signedOut', 'Your account and its data have been deleted.');
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

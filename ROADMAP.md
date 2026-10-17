# Roadmap

This is the durable plan for the project — read this first, regardless of which
session or machine you're picking work up from. **Live task status lives in
[GitHub Issues](../../issues), not in this file.** This file explains the *phases*,
their order, dependencies, and the reasoning behind non-obvious decisions. Issues
are the checklist; this is the map.

Each phase has a GitHub Milestone and a label (`phase-N-*`) applied to its issues.
Run `gh issue list --label phase-1-music` (etc.) to see live status for a phase.

## Constraints that shape this plan

- **Fully open source.** No paid dependencies in the core stack.
- **No spending beyond hosting.** Every tool/service chosen below has a free tier
  or is self-hostable at no cost.
- One consequence: **Sign in with Apple requires a paid Apple Developer account
  ($99/yr)**, which conflicts with the constraint above. It is on the Phase 4
  plan (#21) but waits for the owner to confirm that cost.
- **Goal beyond a personal tool:** eventually invite other people to create
  accounts and keep their own libraries, and later share and recommend between
  users. This shapes the Phase 3 and 4 decisions (see Decisions).
- **Hosting is the one accepted cost.** The owner currently has no hosting (a
  HostGator subscription turned out to have lapsed, October 2026); see the hosting
  decision below.

## Status

| Phase | Name | Status | Milestone |
|---|---|---|---|
| 0 | Foundation | ✅ Done | — |
| 1 | Music content type | ✅ Done | [Phase 1](../../milestone/1) |
| 2 | Natural-language add/find assistant | ✅ Done | [Phase 2](../../milestone/2) |
| 3 | Backend foundation (DB) | ✅ Done | [Phase 3](../../milestone/3) |
| 3.5 | Port to Vue + Vite | ✅ Done | [Phase 3.5](../../milestone/7) |
| 4 | Auth & multi-user | 🔶 In progress | [Phase 4](../../milestone/4) |
| 5 | Reconnect assistant to backend | 🔲 Not started | [Phase 5](../../milestone/5) |
| 6 | Sharing & recommendations | 🔲 Not started | [Phase 6](../../milestone/6) |

## Decisions

### Backend and hosting: Supabase free + free static host (decided 2026-10-11, #11)

The app is going to be a public multi-user service (next decision), so a backend
with built-in auth and declarative per-user access rules is worth more than it
was for a single-user tool. Hand-written auth means owning the security.

- **PocketBase on a VPS** (for example Hetzner, about €5.50–6/month including IPv4
  per an August 2026 comparison; prices rose twice in 2026, confirm on
  hetzner.com). Least custom code: database, Google login, admin screen and API.
  Costs money monthly, needs a server to maintain and backups to arrange.
- **Supabase free tier.** Ready-made auth and database, but free projects pause
  after one week of inactivity (per its pricing page) until restored by hand;
  removing the pause needs the $25/month Pro plan. Matters less once users keep it
  active, but hurts early on.
- **Cloudflare Pages + Workers + D1, free.** Static assets are free and unlimited;
  Workers free is 100,000 requests/day and 10 ms CPU per invocation (Cloudflare's
  pricing page). D1's limits (about 5 GB, daily read/write caps) come from
  secondary sources only. Also fits the Phase 5 key proxy. Auth and API are custom
  code.
- **HostGator:** ruled out. The owner's subscription has ended.
- **Oracle Always Free:** not recommended (card required, frequent capacity
  shortages, idle instances reclaimed, a reported June 2026 allowance cut that
  could not be confirmed).
- **Not evaluated:** Render, Fly.io, Railway, Netlify, Vercel.
- **Decision (owner, 2026-10-11): Supabase free tier for the database and auth,
  with the static page on a free static host (Cloudflare Pages or GitHub Pages).**
  Zero cost, ready-made Google login and per-user row rules (so less security code
  to own), and standard Postgres that can move to a self-hosted Supabase or another
  Postgres later. Fallback if the free limits or the pause become a problem:
  PocketBase on a VPS (about €6/month). A custom domain is optional to start;
  free subdomains exist on both static hosts.
- **Exit plan (owner, 2026-10-11): start on Supabase free, move to PocketBase when
  it stops fitting.** Move when any of these happens: the keep-alive can't keep
  the project awake or Supabase objects to it; the database nears 500 MB; we need
  real backups beyond our own export; the free terms change; or growth makes
  the $25/month Pro plan the alternative. Targets: PocketBase on a managed host
  (PocketHost about $5–10/month, Render about $7, Railway or Fly.io about $5–15;
  sources conflict, verify live prices) or a Hetzner server (about €6/month).
  Supabase Pro ($25/month, no pausing, 7-day daily backups) is the no-move option.
- **What a later move costs.** The data is easy: our own JSON export and import.
  To redo: the client calls (supabase-js to the PocketBase SDK), the access rules
  (row-level policies to PocketBase API rules), the server function (Edge Function
  to a PocketBase hook), and sign-in (people log in with Google again and we match
  their data by email; verify at the time). The separate static host may go away,
  since PocketBase can serve the page itself.
- **Keep the move cheap (#41).** All backend calls go through one small storage
  adapter instead of being scattered through the page, the schema stays plain (no
  Postgres-only features), Export/Import (#16) keeps working as the migration
  path, and the Groq proxy stays small and separate.
- **Keep-alive:** a free GitHub Actions cron every 2–3 days (it can't do "every 6
  days") that runs a real read on a small table, so the project doesn't pause
  after a week idle. Supabase's docs don't say exactly what counts as activity
  (they describe a few database requests a day), so test it. Caveat: GitHub
  disables scheduled workflows in a public repo after 60 days with no repository
  activity, so a long absence can switch it off silently; re-enable it from the
  Actions tab. Or accept the pause while the project only holds the owner's data.
- **Secrets:** the page may contain only Supabase's public key, which is safe
  because per-user rules protect the data. The secret (service role) key never
  goes in the HTML; it belongs in `secrets.json`.
- **The Groq key** can't stay in the page once others use it. Proxy it through a
  server-side function (Supabase Edge Function or a Cloudflare Worker) in Phase 5.
- **To verify while setting up (#12):** that a daily keep-alive ping is fine under
  Supabase's terms; whether an EU region can be chosen at project creation (for EU
  users' data); whether sign-up needs a payment card; the Google login setup; and
  the free Edge Function limits.
- **Sequencing: the app switch ships together with login and row rules.** Moving
  the app onto the database (#15) must land with Google login and per-user rules
  (#17–#19), not before them. The page's public key is visible to everyone, so
  without row rules anyone could read and change all the data. Tables created with
  SQL start with row-level security switched off: switch it on and test it (#31).
  Until then, experiment against a private copy of the data.

**Free-tier drawbacks to plan around** (checked 2026-10-11; mostly from Supabase's
docs and changelog, the rest from third-party sources and marked as such):

- **Projects pause after 7 days of low activity** (Supabase docs). The app is down
  until someone restores the project by hand in the dashboard. A paused project is
  restorable for 90 days (changelog); after that only a download of the last
  logical backup and the storage files remains. Mitigation: the keep-alive (#39).
  The $25/month Pro plan removes pausing.
- **Assume no backups.** One blog says the free tier keeps zero days of backups
  (not confirmed in Supabase's backup docs). Restoring a paused project gives only
  the state at pause. So we need our own regular export (#27, now a weekly encrypted dump).
- **Email login is throttled.** The built-in auth email is about 2 messages an hour
  for the whole project, and only to team members' addresses (third-party
  sources). Use Google login only, or add custom SMTP (another provider; default
  30 an hour).
- **Limits** (third-party, confirm on supabase.com/pricing): 500 MB database, 2
  active projects, 1 GB file storage, 5 GB bandwidth, 50,000 monthly users, 7-day
  logs. Edge Functions about 500,000 invocations a month and 10 s per run (figures
  differ between sources). All far above what this app needs.
- **No guarantees.** One article reports the free limits changed several times in
  past years. Keep the data portable (plain Postgres plus our own export) so a
  move to PocketBase on a VPS stays possible.
- **Not verified:** whether free projects share compute, and any free-tier uptime
  commitment.
- **Never upload the whole project folder to a public web root.** `secrets.json`
  and `media-archive-data.json` would become readable. Deploy only the HTML file
  and backend code.

### Move to Vue + Vite, before the app switch (decided 2026-10-11)

- **Owner's goal:** move from the single HTML file to a proper JS framework with
  ES modules: Vue 3, built with Node (Vite).
- **Timing: a new Phase 3.5, after the schema work (#13) and before the app switch
  (#15).** #15, the storage adapter (#41) and Phase 4 rewrite storage and add
  login and account screens. Building them in the old file first would mean
  writing them twice. Google login also can't return to a page opened from disk
  (`file://`), so from Phase 4 on a local server is needed anyway; the Vite dev
  server is that. The migration script (#14) is a standalone Node script and
  doesn't depend on the port.
- **Shape:** a straight port with feature parity, same file-based storage, now
  behind the storage adapter. Plain JavaScript (TypeScript can come later file by
  file). No Pinia; Vue's built-in reactive state is enough for one entries list.
  Tests move into the repo as Vitest + Vue Test Utils. The old
  `media-archive.html` stays until the owner has checked parity. (Owner checked
  it on 2026-10-11 and the old file was removed; it's in git history.)
- **Cost:** none in money (Vue, Vite and Vitest are MIT; Cloudflare Pages and
  GitHub Pages build with Node for free). It drops the no-build-step house rule,
  testing becomes `npm run dev` and localhost instead of opening the file, and
  npm dependencies need occasional updates (`npm audit`, Dependabot, both free).
  New features pause during the port.

### Multi-user and sharing (2026-10-11)

Goal: invite others to create accounts and personal libraries, then add sharing
and recommendations between users.

- **Store canonical external IDs with every entry** (Wikidata QID, Open Library
  work id, iTunes id) from Phase 3 on. The lookups already find them but the app
  discards them today. They are how the app knows two users logged "the same Dune".
  The migration (#14) should backfill the existing entries.
- **Schema shape (decided 2026-10-11, #13): per-user entries only for now.** One
  `entries` table (`supabase/migrations/`), keyed by user and the app's own entry
  id, with separate nullable `wikidata_id`, `openlibrary_id` and `itunes_id`
  columns and a `visibility` column (default private). Works are matched across
  users by those ids. A shared catalogue would make cover reuse easier but raises
  who may edit shared rows; it can be added later as a table built from the ids.
  Schema changes go in as Supabase CLI migrations, applied with `supabase db push`.
- **Private by default.** Notes (`insights`) often name people, so keep them
  private even when an entry or rating is shared. Levels: private, friends, public.
- **Invite-only sign-up (invite codes) at first**, to limit abuse and quota use.
- **Social features are staged (Phase 6):** friends and read-only library view,
  then explicit recommendations with a note (an inbox), then aggregates such as
  "friends who rated this 4+" and "also liked", which need the canonical IDs.
- **The Groq quota is shared by every user** (1,000 requests/day, 8,000
  tokens/minute). Fine for a handful of friends. Beyond that, per-user limits or
  bring-your-own-key.
- **Lookups stay in each user's browser** (Wikidata, Open Library, iTunes), so they
  don't concentrate on one server.
- **Public-service obligations.** If any users are in the EU, UK or Switzerland,
  expect a privacy policy, data export and account deletion. Groq's regional terms
  are still unreviewed. Check the licences and attribution terms of the cover and
  metadata sources before serving them publicly. Plan backups. Add tests that one
  user cannot read another's data.

### Phase 2 LLM provider: Groq by default, Gemini swappable (2026-10-08, issue #5)

- **Default provider: Groq.** Models with strict JSON-schema output at the time of
  writing: `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`
  (`response_format: json_schema` with `strict: true`).
- **Build the assistant behind one small provider function** so the provider can be
  swapped without touching the chat UI or intent logic. Gemini stays available for
  testing through that seam.
- **Why not Gemini's free tier by default:** Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms)
  say only Paid Services may be used when making API clients available to users in
  the EEA, Switzerland and the UK, and that free-tier content may be used to improve
  Google products and read by human reviewers. That conflicts with the no-spend
  constraint and with personal notes in entries. This was read via a page
  summarizer — read the terms directly before relying on it.
- **Browser access works for both** from a `file://` page (CORS preflight checked
  2026-10-08: Gemini echoes `null`, Groq returns `*`). Unlike the iTunes Search
  API, no JSONP workaround is needed.
- **Groq data handling:** its docs say inference requests are not retained by
  default. Its Services Agreement / DPA has not been reviewed.
- **Gemini API drift:** the current docs show a new `/v1beta/interactions` endpoint
  with a `response_format` object and Gemini 3.x model IDs (e.g. `gemini-3.8-flash`).
  Follow the current docs when wiring it up, not older `generateContent` examples.
- **Verified on 2026-10-08 (from response headers on a real free-tier key):** Groq
  `openai/gpt-oss-20b` allows 1,000 requests/day and 8,000 tokens/minute. One
  extraction call uses roughly 750 tokens, so about 10 messages per minute.
- **Implementation findings** (the "Describe it" add view): `openai/gpt-oss-20b`
  answers in about 0.5–2s. At `reasoning_effort: "low"` strict JSON mode was flaky
  (an empty answer failed validation about 1 in 4 times, and it sometimes dropped
  the artist or got "last week" wrong); at `"medium"` it was 6/6 correct on hard
  cases. The app uses `medium` plus one automatic retry on `json_validate_failed`.
- **Ask-the-library cost:** a question uses about 1,100–1,450 tokens (the filter
  prompt is longer than the add prompt), so roughly 5 questions per minute on the
  8,000 tokens/minute free tier. Only the typed question is sent, never the library.
- **Groq error responses carry `access-control-allow-origin: *`**, so a bad key or
  rate limit reaches the browser as a real status code (and gets a specific
  message), not as a generic network failure. `retry-after` is not readable
  cross-origin, so the app says "wait a minute" instead of a precise delay.
- **Not verified:** Groq's regional terms (EEA/UK/CH), and Gemini's free-tier rate
  limits. Re-check before relying on them.

---

## Phase 0 — Foundation (done)

Single-file HTML app. Local JSON storage via the File System Access API. Add/Edit
dialog with auto-fill lookup (Wikidata, Open Library, iTunes). Card grid with
filters, search, date range, and type tags. Published as an MIT-licensed repo.

## Phase 1 — Music as a content type

No infrastructure dependency — do this before the DB phase so the schema is
right from the start rather than migrated twice. Adds `medium: "music"` plus
artist/album fields and optional Spotify/YouTube links. iTunes Search API
(already used as a cover-art fallback) also covers music, so lookup reuses
existing plumbing.

## Phase 2 — Natural-language add/find assistant

Deliberately sequenced *before* the backend work, and built against the
*current* local JSON file. This validates the chat interaction model cheaply,
without waiting on infrastructure. Uses a free-tier LLM API (Groq or Gemini
Flash) called directly from the browser. It will be re-pointed at the real
backend in Phase 5, not rebuilt.

## Phase 3 — Backend foundation

**Status: done (2026-10-13).** Supabase is live with keep-alive (#39) and hosting
(#40). Canonical ids (#26): lookups now store them, and
`scripts/backfill-ids.mjs` fills existing entries (dry run first; unclear
matches are left for a manual Look up). Backups (#27): a weekly GitHub Action
dumps roles, schema and data (including auth users), encrypts with `age`, and
keeps 90 days of artifacts; `scripts/restore-test.sh` restores the latest into a
throwaway local Supabase. Keep the age private key outside the repo; without it
the backups can't be read.

The original plan had "build a DB" and "add auth" as separate steps. They're
combined here: pick a free, open-source backend-as-a-service that bundles a
database *and* auth together (PocketBase or Supabase — both free/open source),
so this is one setup effort instead of two custom builds. This phase builds the
database and migrates the existing JSON into it. It does not go live on its own:
the app switch (#15) ships together with login and per-user rules (see the
sequencing note in Decisions).

Because the app is headed for many users, design the schema for that now: store
canonical external IDs on entries, decide catalogue versus per-user entries, and
plan backups (see Decisions). Hosting is decided: Supabase free tier plus a free
static host. Do this work on a branch so the current file-based app stays usable
until the switch.

## Phase 3.5 — Port to Vue + Vite (done 2026-10-11)

Port the single-file app to Vue 3 + Vite with ES modules, keeping every feature
and the file-based storage, now behind the storage adapter (#41). This comes
before the app switch (#15) so the backend and login work is written once, in
the new app. See Decisions, "Move to Vue + Vite".

## Phase 4 — Auth & multi-user

**Status (2026-10-13):** the app runs on Supabase with Google sign-in (#15, #17,
#18, #19 done), hosted on GitHub Pages at https://slatiner.github.io/content-library/
(#40, built by `.github/workflows/pages.yml`).

**Invite codes (#28): done (live and verified 2026-10-17).** New user sign-ups are on (email provider still off).
Google sign-in can't carry a code into account creation, so sign-up opens but
a new account can do nothing until it redeems a code (`members` and `invites`
tables, `redeem_invite` / `create_invite` functions, a restrictive members-only
policy on `entries`, and a membership check in the Groq proxy). Only admins
(the owner) create codes, from "Invite someone" in the account menu; codes are
single-use and expire after 14 days, and an `?invite=CODE` link fills the code
in. Accounts that never redeem stay empty; a cleanup for them isn't built yet.

**Authorization tests (#31): done for today's rules (2026-10-17).**
`npm run test:db` (needs `supabase start`) runs a pgTAP suite,
`supabase/tests/database/authz.test.sql`, on the local database: per-user
entries, members-only access, invites, signed-out access, and checks over every
table (row-level security on, no grants to anon beyond keepalive, no TRUNCATE
etc.), so a new table that forgets them fails. `supabase/tests/rls_check.sql`
repeats the key checks on the live project with the real second account, and
rolls back. #31 stays open for the visibility levels, which get tests with #20.

**Next, in order:** the visibility model (#20, with its tests under #31), privacy basics (#29), licences check (#30), and Sign in
with Apple (#21, below) once the owner approves the $99/yr. Per-user assistant
limits (#25, Phase 5) should land before invites go beyond a few friends, since
every signed-in user shares the owner's Groq key and quota (#24).

Mostly configuration once Phase 3's tool is in place. Google login and the
per-user rules (#17–#19) ship together with the app switch (#15), not after it.
Start with **Google**
OAuth (free); GitHub is a good second option given the audience.

**Sign in with Apple (#21): on the roadmap, after hosting (#40).** Added at the
owner's request on 2026-10-13. Supabase supports it, but it needs a paid Apple
Developer Program account ($99/yr), which breaks the "no spending beyond hosting"
rule. It also needs the deployed domain from #40, and Apple's client secret
expires every six months and has to be regenerated. The owner confirms the $99/yr
before it's built. This phase must also decide
the visibility model (private, friends, public; notes private by default) since
it affects the schema. It is also where the app starts holding other people's
data, so it covers invite-only sign-up, privacy basics (policy, data export,
account deletion), a check of cover and metadata licences, and tests that one
user cannot read another's data.

## Phase 5 — Reconnect the assistant, add real search

**Pulled forward (2026-10-13): the Groq key is server side (#24).** The online
app calls `supabase/functions/groq`, which checks the caller is signed in, allows
only the app's model and token cap, and holds the key as the Supabase secret
`GROQ_API_KEY`. Every signed-in user shares the owner's key and quota, which is
fine while sign-up is closed; per-user limits (#25) come before invites open
widely. File mode (`VITE_STORAGE=file`) still uses a key from `secrets.json` or
the browser. Redeploy with `supabase functions deploy groq --no-verify-jwt`.

Points Phase 2's assistant at the Phase 3/4 backend instead of the local file,
and adds the "find" half properly — natural-language search only makes sense
once there's a real queryable DB behind it. Also moves the LLM API key
server-side: a client-side key is fine solo, but becomes a shared, abusable
quota once multiple users exist. Decide here whether users share one key with
per-user limits or bring their own, and review Groq's terms for EEA/UK/CH users
before opening the assistant to anyone else.

## Phase 6 — Sharing & recommendations

Built on Phases 3–5, in stages so each one is useful on its own:

1. **Friends:** connect through an invite link with mutual approval, and view a
   friend's library read-only, respecting visibility settings.
2. **Recommendations:** send an item to a friend with a note and show it in an
   inbox. Explicit and human, not algorithmic.
3. **Aggregates:** "friends who rated this 4+" on an item, and later "friends who
   liked X also liked Y". These need the canonical IDs from Phase 3.

Sharing user-written notes also needs basic blocking and reporting.

## Open questions / not yet scheduled

- Music embeds via Spotify/YouTube oEmbed (nice-to-have, not blocking)
- Full-text/semantic search once the DB exists
- Public profile pages beyond friends

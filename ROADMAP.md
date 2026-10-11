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
  ($99/yr)**, which conflicts with the constraint above. It's deferred rather
  than dropped — revisit if that changes.
- **Goal beyond a personal tool:** eventually invite other people to create
  accounts and keep their own libraries, and later share and recommend between
  users. This shapes the Phase 3 and 4 decisions (see Decisions).
- **Hosting is the one accepted cost.** The owner has a paid HostGator account
  (plan type not yet confirmed); see the hosting decision below.

## Status

| Phase | Name | Status | Milestone |
|---|---|---|---|
| 0 | Foundation | ✅ Done | — |
| 1 | Music content type | ✅ Done | [Phase 1](../../milestone/1) |
| 2 | Natural-language add/find assistant | ✅ Done | [Phase 2](../../milestone/2) |
| 3 | Backend foundation (DB) | 🔲 Not started | [Phase 3](../../milestone/3) |
| 4 | Auth & multi-user | 🔲 Not started | [Phase 4](../../milestone/4) |
| 5 | Reconnect assistant to backend | 🔲 Not started | [Phase 5](../../milestone/5) |
| 6 | Sharing & recommendations | 🔲 Not started | [Phase 6](../../milestone/6) |

## Decisions

### Backend and hosting: open, decide in #11 (researched 2026-10-11)

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
- **HostGator** (the owner's paid account, plan unconfirmed). Serving the static
  page works on any plan. Third-party reviews list PHP, MySQL, cron and SSH on
  shared plans. PocketBase probably can't run on shared hosting (it is a
  persistent process; HostGator's own policy was not found). Its comparison chart
  lists scheduled backups as unavailable on shared plans. Would mean custom PHP
  auth and API.
- **Oracle Always Free:** not recommended (card required, frequent capacity
  shortages, idle instances reclaimed, a reported June 2026 allowance cut that
  could not be confirmed).
- **Not evaluated:** Render, Fly.io, Railway, Netlify, Vercel.
- **Current lean, not a decision:** HostGator only if the plan has SSH and the
  owner is happy to own the auth code. Otherwise PocketBase on a VPS (least code,
  matches this roadmap) or Cloudflare (no cost, more code).
- **Still needed from the owner:** HostGator plan type, PHP version, whether a
  Terminal/SSH tool and "Setup Node.js App" exist in cPanel, and the domain to use.
- **Never upload the whole project folder to a public web root.** `secrets.json`
  and `media-archive-data.json` would become readable. Deploy only the HTML file
  and backend code.

### Multi-user and sharing (2026-10-11)

Goal: invite others to create accounts and personal libraries, then add sharing
and recommendations between users.

- **Store canonical external IDs with every entry** (Wikidata QID, Open Library
  work id, iTunes id) from Phase 3 on. The lookups already find them but the app
  discards them today. They are how the app knows two users logged "the same Dune".
  The migration (#14) should backfill the existing entries.
- **Schema shape is a Phase 3 decision (#13):** a shared catalogue of works with
  per-user entries on top, or per-user entries only. The catalogue makes
  recommendations and cover reuse easier.
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

The original plan had "build a DB" and "add auth" as separate steps. They're
combined here: pick a free, open-source backend-as-a-service that bundles a
database *and* auth together (PocketBase or Supabase — both free/open source),
so this is one setup effort instead of two custom builds. This phase migrates
existing JSON data into it but stays single-user — multi-user is Phase 4.

Because the app is headed for many users, design the schema for that now: store
canonical external IDs on entries, decide catalogue versus per-user entries, and
plan backups (see Decisions). The hosting choice is made here too (#11).

## Phase 4 — Auth & multi-user

Mostly configuration once Phase 3's tool is in place. Start with **Google**
OAuth (free); GitHub is a good second option given the audience. **Apple
Sign-In is deferred** — see Constraints above. This phase must also decide
the visibility model (private, friends, public; notes private by default) since
it affects the schema. It is also where the app starts holding other people's
data, so it covers invite-only sign-up, privacy basics (policy, data export,
account deletion), a check of cover and metadata licences, and tests that one
user cannot read another's data.

## Phase 5 — Reconnect the assistant, add real search

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
- Moving the headless DOM tests into the repo (they need a dev-only dependency,
  jsdom) once authorization tests exist

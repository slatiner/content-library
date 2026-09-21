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

## Status

| Phase | Name | Status | Milestone |
|---|---|---|---|
| 0 | Foundation | ✅ Done | — |
| 1 | Music content type | ✅ Done | [Phase 1](../../milestone/1) |
| 2 | Natural-language add/find assistant | 🔲 Not started | [Phase 2](../../milestone/2) |
| 3 | Backend foundation (DB) | 🔲 Not started | [Phase 3](../../milestone/3) |
| 4 | Auth & multi-user | 🔲 Not started | [Phase 4](../../milestone/4) |
| 5 | Reconnect assistant to backend | 🔲 Not started | [Phase 5](../../milestone/5) |

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

## Phase 4 — Auth & multi-user

Mostly configuration once Phase 3's tool is in place. Start with **Google**
OAuth (free); GitHub is a good second option given the audience. **Apple
Sign-In is deferred** — see Constraints above. This phase must also decide
the visibility model (private-only vs. shareable libraries) since it affects
the schema.

## Phase 5 — Reconnect the assistant, add real search

Points Phase 2's assistant at the Phase 3/4 backend instead of the local file,
and adds the "find" half properly — natural-language search only makes sense
once there's a real queryable DB behind it. Also moves the LLM API key
server-side: a client-side key is fine solo, but becomes a shared, abusable
quota once multiple users exist.

## Open questions / not yet scheduled

- Music embeds via Spotify/YouTube oEmbed (nice-to-have, not blocking)
- Full-text/semantic search once the DB exists
- Public/shareable profile pages

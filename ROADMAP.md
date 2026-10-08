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
| 2 | Natural-language add/find assistant | 🔶 In progress | [Phase 2](../../milestone/2) |
| 3 | Backend foundation (DB) | 🔲 Not started | [Phase 3](../../milestone/3) |
| 4 | Auth & multi-user | 🔲 Not started | [Phase 4](../../milestone/4) |
| 5 | Reconnect assistant to backend | 🔲 Not started | [Phase 5](../../milestone/5) |

## Decisions

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

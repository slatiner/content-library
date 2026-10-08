# Working on this repo

## Where project state actually lives

This project is worked on across multiple, unrelated Claude Code sessions. **Do
not rely on conversation history or memory for roadmap/status — it will not be
there in a fresh session.** Always check these instead:

- **`ROADMAP.md`** — the phases, their order, and *why* they're ordered that way
  (dependencies, cost/tradeoff decisions). Read this first.
- **GitHub Issues** (`gh issue list`) — the live, checkable task list. Each issue
  belongs to exactly one phase via a `phase-N-*` label and milestone.
- **GitHub Milestones** (`gh api repos/:owner/:repo/milestones`) — one per phase,
  tracks aggregate progress.

To see what's actually open right now for a given phase:
```
gh issue list --label phase-1-music --state open
```

When you finish a piece of work, close the corresponding issue (`gh issue close
<number>`) rather than just saying it's done in chat — the next session (which
may not see this conversation at all) needs the state to be true in GitHub, not
just true in this transcript.

## Project constraints (see ROADMAP.md for full reasoning)

- Fully open source, MIT licensed.
- No paid dependencies in the core stack — hosting cost is the only accepted
  exception. Any new dependency should have a genuinely free tier or be
  self-hostable at no cost.
- Sign in with Apple is deferred (requires a $99/yr Apple Developer account,
  which conflicts with the constraint above) — don't implement it without
  re-confirming this tradeoff with the user first.

## Secrets

This repo is public. API keys and tokens live in **`secrets.json`** at the repo
root, which is gitignored (as are `.env` and `.env.*`). `secrets.example.json`
documents the shape and is the only secrets-related file that gets committed.

- Never commit, print, log, or paste a key into code, commit messages, issues, or
  docs. When a command needs a key, read it from `secrets.json` in the shell
  instead of writing it inline.
- Add any new secret to `secrets.json` and a placeholder to `secrets.example.json`.
- Before committing, check that `git status` doesn't list `secrets.json`.
- The browser app can read `secrets.json` from the connected data folder through
  the same folder handle it already uses for `media-archive-data.json`. Don't
  hard-code keys in `media-archive.html`.

## House style

- This is a no-build-step project: one HTML file with inline CSS/JS. Keep new
  work dependency-free where reasonably possible rather than introducing a
  bundler/framework.
- Data schema changes (adding a field, a new `medium` type) should be reflected
  in `media-archive-data.example.json` too, not just the real (gitignored) data
  file.

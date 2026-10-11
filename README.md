# Content Library

A self-hosted media archive for tracking the films, series, books and music you've consumed. Today your data lives in a plain JSON file on your own machine; a hosted, multi-user version backed by Supabase is in progress (see the roadmap).

![type](https://img.shields.io/badge/status-personal%20project-blue)

## Features

- **Card grid** with cover art, star ratings, and a colored type badge (book / film / series / music), responsive up to 6 columns per row
- **Filters**: text search, a date-range picker, and toggleable type tags
- **Describe it** (optional): the Add dialog opens on a plain-language box. Type something like "Perfect Blue, solid 4, watched two weeks ago, note: anime night" and it works out the type, title, rating, date and note, looks up the cover and details (if more than one item matches, you pick the right one), and shows a preview to confirm. Press Enter to send, and Enter again to add. It uses a free [Groq](https://console.groq.com/) API key (see [Natural-language add](#natural-language-add-optional)). The **Manual** tab is the regular form.
- **Ask your library** (optional, same Groq key): type a question in the search box and press Enter, e.g. "films I rated above 4 this year", "Murakami", "series I rated below 3", or "best music from the 90s". It sets the type tags, date range, sort and a rating / release-year filter, and shows what it understood as chips with a **Clear** button. Without a key, or if Groq is unreachable, the search box keeps working as a normal text search. In the Vue version you can also add from the search box: "just watched Dune, 4 stars" opens the Describe it preview, and Enter adds it.
- **Add/Edit dialog** with a "Look up" button that auto-fills director, cast, year, and cover art from free public sources:
  - [Wikidata](https://www.wikidata.org/) + [Wikipedia](https://www.wikipedia.org/) for films and series
  - [Open Library](https://openlibrary.org/) for books
  - [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) for music, and as a cover-art fallback for films and series
- **Local file storage** via the browser's File System Access API — your data is a `media-archive-data.json` file you own and control, not a hosted database
- **Manual Export / Import** as a JSON backup, or to move data between browsers/machines
- Hover any card to see cast/director/author, the date consumed, and your notes

## Getting started

The app is Vue 3 + Vite and needs a current [Node.js](https://nodejs.org/) (tested with 22).

```
npm install
npm run dev     # opens on http://localhost:5173
npm test        # component tests
npm run build   # static site in dist/
```

1. Open http://localhost:5173 in **Chrome, Edge, or Brave** (see [Browser notes](#browser-notes) below).
2. Click **Connect folder** and pick a folder for your data (for example this repo's folder). The app will create `media-archive-data.json` there automatically.
3. Click **+ Add new** to start logging what you watch and read.

Want to see the data shape before adding your own? Check [`media-archive-data.example.json`](./media-archive-data.example.json).

The app's source is in `app/`. The dev server only serves that folder and its packages, so `secrets.json` and your data file in the repo root are never served.

### Natural-language add and search (optional)

The "Describe it" view and "Ask your library" need a free API key from [Groq](https://console.groq.com/keys). Without one, the Manual tab and plain search work exactly as before.

1. Create a key, then copy [`secrets.example.json`](./secrets.example.json) to `secrets.json` in your data folder (the one you connect) and paste the key in. `secrets.json` is gitignored, so it won't be committed.
2. Or skip the file: the dialog asks for the key the first time and stores it in your browser only.

Your message or question is sent to Groq to be parsed (it never sees your whole library, only what you type); the lookups (Wikidata, Open Library, iTunes) then run from your browser. The free tier allows about 10 adds or 5 questions a minute.

### Browser notes

The File System Access API (used for "Connect folder") requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts); `http://localhost` counts as one. Also:

- **It will not work in a Private/Incognito window** — persistent storage permissions are disabled there by design.
- **Brave** sometimes blocks this more aggressively via Shields or site permissions. If "Connect folder" fails, try lowering Shields for the page, or check `brave://settings/content/all` for a blocked "File editing" permission on the file's origin.
- If your browser doesn't support the API at all, the app still works — use **⚙ → Export / Import JSON** to manage your data manually.

## Project status & roadmap

This is an evolving personal project: a Vue app with file-based storage today, moving onto a Supabase backend with login next. See [`ROADMAP.md`](./ROADMAP.md) for the phased plan and the reasoning behind it, and [issues](../../issues) for live task status per phase.

## Contributing

Issues and PRs welcome. Keep npm dependencies few and free (MIT or similar), and run `npm test` before opening a PR.

## License

[MIT](./LICENSE)

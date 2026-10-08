# Content Library

A single-file, self-hosted media archive for tracking films, series, and books you've consumed — no server, no signup, no database. Your data lives in a plain JSON file on your own machine.

![type](https://img.shields.io/badge/status-personal%20project-blue)

## Features

- **Card grid** with cover art, star ratings, and a colored type badge (book / film / series / music), responsive up to 6 columns per row
- **Filters**: text search, a date-range picker, and toggleable type tags
- **Describe it** (optional): the Add dialog opens on a plain-language box. Type something like "Perfect Blue, solid 4, watched two weeks ago, note: anime night" and it works out the type, title, rating, date and note, looks up the cover and details, and shows a preview to confirm. It uses a free [Groq](https://console.groq.com/) API key (see [Natural-language add](#natural-language-add-optional)). The **Manual** tab is the regular form.
- **Add/Edit dialog** with a "Look up" button that auto-fills director, cast, year, and cover art from free public sources:
  - [Wikidata](https://www.wikidata.org/) + [Wikipedia](https://www.wikipedia.org/) for films and series
  - [Open Library](https://openlibrary.org/) for books
  - [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) for music, and as a cover-art fallback for films and series
- **Local file storage** via the browser's File System Access API — your data is a `media-archive-data.json` file you own and control, not a hosted database
- **Manual Export / Import** as a JSON backup, or to move data between browsers/machines
- Hover any card to see cast/director/author, the date consumed, and your notes

## Getting started

1. Download `media-archive.html` into a folder of your choice.
2. Open it in **Chrome, Edge, or Brave** (see [Browser notes](#browser-notes) below).
3. Click **Connect folder** and pick the folder you put the file in. The app will create `media-archive-data.json` there automatically.
4. Click **+ Add new** to start logging what you watch and read.

Want to see the data shape before adding your own? Check [`media-archive-data.example.json`](./media-archive-data.example.json).

### Natural-language add (optional)

The "Describe it" view needs a free API key from [Groq](https://console.groq.com/keys). Without one, the Manual tab works exactly as before.

1. Create a key, then copy [`secrets.example.json`](./secrets.example.json) to `secrets.json` in the same folder as `media-archive.html` and paste the key in. `secrets.json` is gitignored, so it won't be committed.
2. Or skip the file: the dialog asks for the key the first time and stores it in your browser only.

Your message is sent to Groq to be parsed; the lookups (Wikidata, Open Library, iTunes) then run from your browser.

### Browser notes

The File System Access API (used for "Connect folder") requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). Opening the file directly (`file://...`) works in most cases, but:

- **It will not work in a Private/Incognito window** — persistent storage permissions are disabled there by design.
- **Brave** sometimes blocks this more aggressively via Shields or site permissions. If "Connect folder" fails, try lowering Shields for the page, or check `brave://settings/content/all` for a blocked "File editing" permission on the file's origin.
- If your browser doesn't support the API at all, the app still works — use **⚙ → Export / Import JSON** to manage your data manually.
- For the most reliable experience across browsers, serve the folder over `http://localhost` instead of opening it as a local file (e.g. `python3 -m http.server` from the folder, then visit `http://localhost:8000/media-archive.html`).

## Project status & roadmap

This is an evolving personal project, currently a single static HTML file with no backend. See [`ROADMAP.md`](./ROADMAP.md) for the phased plan and the reasoning behind it, and [issues](../../issues) for live task status per phase.

## Contributing

Issues and PRs welcome. This project has no build step — it's one HTML file with inline CSS/JS — so contributions should stay dependency-free where reasonably possible.

## License

[MIT](./LICENSE)

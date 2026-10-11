// Metadata and cover lookups. These run in the user's browser (see ROADMAP.md).
// Functions that fill details take a form object and only fill empty fields.

const MEDIUM_KEYWORDS = {
  film: ['film', 'movie'],
  series: ['television series', 'tv series', 'miniseries', 'web series'],
  book: ['novel', 'book', 'short story', 'graphic novel', 'literary work'],
};
const MEDIUM_PROPS = {
  film:   { people: ['P57'],        cast: ['P161'], date: ['P577', 'P571'] },
  series: { people: ['P170', 'P57'], cast: ['P161'], date: ['P571', 'P580', 'P577'] },
  book:   { people: ['P50'],        cast: null,     date: ['P577', 'P571'] },
};

export async function wikidataSearch(title) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&format=json&origin=*&limit=6&type=item`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Wikidata search HTTP ' + r.status);
  const d = await r.json();
  return (d.search || []).map((c) => ({ id: c.id, label: c.label || title, description: c.description || '' }));
}

export function candidateMatchesMedium(c, medium) {
  const desc = (c.description || '').toLowerCase();
  return MEDIUM_KEYWORDS[medium].some((k) => desc.includes(k));
}

async function wikidataGetEntity(qid) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|sitelinks&format=json&origin=*`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Wikidata entity HTTP ' + r.status);
  const d = await r.json();
  return d.entities && d.entities[qid] ? d.entities[qid] : null;
}

function firstClaimQids(claims, propList, limit) {
  if (!claims || !propList) return [];
  for (const p of propList) {
    if (claims[p] && claims[p].length) {
      return claims[p].slice(0, limit || 8)
        .map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id)
        .filter(Boolean);
    }
  }
  return [];
}

function firstClaimYear(claims, propList) {
  if (!claims || !propList) return '';
  for (const p of propList) {
    if (claims[p] && claims[p].length) {
      const v = claims[p][0].mainsnak && claims[p][0].mainsnak.datavalue && claims[p][0].mainsnak.datavalue.value;
      if (v && v.time) return v.time.replace('+', '').slice(0, 4);
    }
  }
  return '';
}

function firstImageFilename(claims) {
  if (!claims || !claims.P18 || !claims.P18.length) return '';
  const v = claims.P18[0].mainsnak && claims.P18[0].mainsnak.datavalue && claims.P18[0].mainsnak.datavalue.value;
  return v || '';
}

async function resolveLabels(qids) {
  const unique = [...new Set(qids)].filter(Boolean);
  if (!unique.length) return {};
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${unique.join('|')}&props=labels&languages=en&format=json&origin=*`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Wikidata labels HTTP ' + r.status);
  const d = await r.json();
  const out = {};
  unique.forEach((id) => {
    const ent = d.entities && d.entities[id];
    out[id] = ent && ent.labels && ent.labels.en ? ent.labels.en.value : id;
  });
  return out;
}

async function fetchWikipediaLeadImage(pageTitle) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
    const r = await fetch(url);
    if (!r.ok) return '';
    const d = await r.json();
    if (d.originalimage && d.originalimage.source) return d.originalimage.source;
    if (d.thumbnail && d.thumbnail.source) return d.thumbnail.source;
    return '';
  } catch (e) { return ''; }
}

// TVmaze has real portrait posters for TV shows, and allows browser requests (CORS *).
async function fetchTvmazePoster(title) {
  try {
    const r = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`);
    if (!r.ok) return '';
    const d = await r.json();
    return (d.image && (d.image.original || d.image.medium)) || '';
  } catch (e) { return ''; }
}

// Load an image to read its size. Resolves { w, h }, or null if it doesn't load.
function imageSize(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => done(null), timeoutMs);
    function done(v) { clearTimeout(timer); img.onload = img.onerror = null; resolve(v); }
    img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = url;
  });
}

// Cards are 2:3 portrait. Try each source in order and keep the first portrait
// image; SVGs (usually logos) and wide images are skipped. If nothing portrait
// turns up, fall back to the first image that loads.
async function pickPortraitCover(sources) {
  let fallback = '';
  for (const source of sources) {
    const url = await source();
    if (!url || /\.svg($|[?/])/i.test(url)) continue;
    const size = await imageSize(url);
    if (!size || !size.w) continue;
    if (size.h / size.w >= 1.2) return url;
    if (!fallback) fallback = url;
  }
  return fallback;
}

// iTunes Search API sends no Access-Control-Allow-Origin header, so a plain
// fetch() is blocked by CORS from any browser origin (not just file://).
// JSONP (a <script> tag, not subject to CORS) is the API's own intended
// workaround for client-side use — it supports a `callback` param for this.
export function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'jsonp_cb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('Request timed out')); }, 10000);
    function cleanup() { clearTimeout(timer); delete window[cbName]; script.remove(); }
    window[cbName] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('Request failed')); };
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    document.head.appendChild(script);
  });
}

async function fetchCoverFallback(medium, title, author) {
  try {
    if (medium === 'book') {
      const q = encodeURIComponent(title + (author ? ' ' + author : ''));
      const r = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=1`);
      const d = await r.json();
      if (d.docs && d.docs[0] && d.docs[0].cover_i) return `https://covers.openlibrary.org/b/id/${d.docs[0].cover_i}-L.jpg`;
      return '';
    }
    const media = medium === 'film' ? 'movie' : 'tvShow';
    const d = await jsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=${media}&limit=1`);
    if (d.results && d.results[0] && d.results[0].artworkUrl100) return d.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
    return '';
  } catch (e) { return ''; }
}

export async function applyWikidataDetails(qid, form) {
  const entity = await wikidataGetEntity(qid);
  if (!entity) return false;
  const claims = entity.claims;
  const props = MEDIUM_PROPS[form.medium];

  const peopleQids = firstClaimQids(claims, props.people, 3);
  const castQids = props.cast ? firstClaimQids(claims, props.cast, 6) : [];
  const labels = await resolveLabels([...peopleQids, ...castQids]);

  if (form.medium === 'book') {
    if (!form.author.trim() && peopleQids.length) form.author = peopleQids.map((q) => labels[q]).join(', ');
  } else {
    if (!form.director.trim() && peopleQids.length) form.director = peopleQids.map((q) => labels[q]).join(', ');
    if (!form.cast.trim() && castQids.length) form.cast = castQids.map((q) => labels[q]).join(', ');
  }
  if (!form.year.trim()) {
    const y = firstClaimYear(claims, props.date);
    if (y) form.year = y;
  }
  if (!form.coverUrl.trim()) {
    const enTitle = entity.sitelinks && entity.sitelinks.enwiki && entity.sitelinks.enwiki.title;
    const img = firstImageFilename(claims);
    const title = form.title.trim();
    const sources = [
      form.medium === 'series' && (() => fetchTvmazePoster(title)),
      form.medium !== 'book' && enTitle && (() => fetchWikipediaLeadImage(enTitle)),
      img && (() => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=600`),
      () => fetchCoverFallback(form.medium, title, form.author.trim()),
    ].filter(Boolean);
    const cover = await pickPortraitCover(sources);
    if (cover) form.coverUrl = cover;
  }
  return true;
}

export async function applyItunesMusicDetails(form) {
  const title = form.title.trim();
  const artist = form.author.trim();
  const term = artist ? `${title} ${artist}` : title;
  const d = await jsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=1`);
  const hit = d.results && d.results[0];
  if (!hit) return false;
  if (!form.author.trim() && hit.artistName) form.author = hit.artistName;
  if (!form.year.trim() && hit.releaseDate) form.year = hit.releaseDate.slice(0, 4);
  if (!form.coverUrl.trim() && hit.artworkUrl100) form.coverUrl = hit.artworkUrl100.replace('100x100bb', '600x600bb');
  return true;
}

// Look up form.title for form.medium and fill what's found.
// Returns { status } when done, or { choices, uncertain } when the user must pick
// between several Wikidata matches (the caller shows its own list).
export async function lookupTitle(form) {
  const title = form.title.trim();
  if (!title) return { status: 'Type a title first.' };
  if (form.medium === 'music') {
    try {
      const filled = await applyItunesMusicDetails(form);
      return {
        status: filled
          ? "Filled artist, year, and cover from iTunes. Band members and the listen link aren't auto-filled — add those yourself."
          : 'No match found on iTunes.',
      };
    } catch (e) {
      return { status: `Couldn't reach iTunes — ${e && e.message ? e.message : e}.` };
    }
  }
  try {
    const candidates = await wikidataSearch(title);
    if (!candidates.length) return { status: 'No match found for this title.' };
    const matched = candidates.filter((c) => candidateMatchesMedium(c, form.medium));
    if (matched.length === 1) {
      await applyWikidataDetails(matched[0].id, form);
      return { status: `Filled from Wikidata (${matched[0].label}).` };
    }
    if (matched.length > 1) return { choices: matched, uncertain: false };
    if (candidates.length === 1) {
      await applyWikidataDetails(candidates[0].id, form);
      return { status: `Filled from Wikidata (${candidates[0].label}) — couldn't confirm the medium, worth a check.` };
    }
    return { choices: candidates, uncertain: true };
  } catch (e) {
    return { status: `Couldn't reach Wikidata — ${e && e.message ? e.message : e}.` };
  }
}

export const DIAG_TARGETS = [
  { id: 'wd_search', name: 'Wikidata search', url: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=test&language=en&format=json&origin=*&limit=1&type=item' },
  { id: 'wd_entity', name: 'Wikidata entity detail', url: 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q64&props=labels&languages=en&format=json&origin=*' },
  { id: 'wp_poster', name: 'Wikipedia (film/series poster)', url: 'https://en.wikipedia.org/api/rest_v1/page/summary/Berlin' },
  { id: 'itunes', name: 'iTunes Search (music + cover fallback)', url: 'https://itunes.apple.com/search?term=test&limit=1', via: 'jsonp' },
  { id: 'openlib', name: 'Open Library (book cover)', url: 'https://openlibrary.org/search.json?q=test&limit=1' },
];

export async function checkTarget(t) {
  const start = performance.now();
  try {
    if (t.via === 'jsonp') {
      await jsonp(t.url);
      return `✅ ${t.name}: OK via JSONP (${Math.round(performance.now() - start)}ms)`;
    }
    const r = await fetch(t.url);
    return `${r.ok ? '✅' : '⚠️'} ${t.name}: HTTP ${r.status} (${Math.round(performance.now() - start)}ms)`;
  } catch (e) {
    return `❌ ${t.name}: ${e && e.message ? e.message : e}`;
  }
}

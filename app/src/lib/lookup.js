// Metadata and cover lookups. These run in the user's browser (see ROADMAP.md).
// Functions that fill details take a form object and only fill empty fields,
// except the canonical ids (#26), which always follow the latest match.
import { linkKey, normText } from './entries.js';

// Wikimedia asks browser scripts to identify themselves with this header (its
// User-Agent policy); it's allowed by their CORS rules.
const WIKI_HEADERS = { 'Api-User-Agent': 'content-library/0.1 (https://github.com/slatiner/content-library)' };
const wikiFetch = (url) => fetch(url, { headers: WIKI_HEADERS });

function link(form, ids) {
  Object.assign(form, ids);
  form.linkedFor = linkKey(form);
}

// Open Library work id (OL…W) from a Wikidata item's P648 claims, if any.
export function openLibraryWork(claims) {
  const vals = ((claims && claims.P648) || []).map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value);
  return vals.find((v) => typeof v === 'string' && /^OL\d+W$/.test(v)) || '';
}

// Open Library work id by search, kept only when the found title matches.
export async function openLibrarySearchWork(title, author) {
  try {
    const q = encodeURIComponent(title + (author ? ' ' + author : ''));
    const r = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=1&fields=key,title`);
    if (!r.ok) return '';
    const doc = ((await r.json()).docs || [])[0];
    if (!doc || linkKey({ title: doc.title }) !== linkKey({ title })) return '';
    return (String(doc.key || '').match(/OL\d+W$/) || [''])[0];
  } catch (e) { return ''; }
}

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
  const r = await wikiFetch(url);
  if (!r.ok) throw new Error('Wikidata search HTTP ' + r.status);
  const d = await r.json();
  return (d.search || []).map((c) => ({ id: c.id, label: c.label || title, description: c.description || '' }));
}

// Wikidata "instance of" (P31) classes per medium, for the typed search below.
const MEDIUM_CLASSES = {
  // film, animated film, television film, animated feature film, documentary film, short film
  film: ['Q11424', 'Q24869', 'Q506240', 'Q202866', 'Q93204', 'Q24862'],
  // television series, miniseries, web series, anime television series, animated television series, animated series
  series: ['Q5398426', 'Q1259759', 'Q526877', 'Q63952888', 'Q117467246', 'Q581714'],
  // literary work, book, novel, written work, graphic novel, short story, novel series
  book: ['Q7725634', 'Q571', 'Q8261', 'Q47461344', 'Q725377', 'Q49084', 'Q1667921'],
};

// Full-text search limited to items of the medium's classes, so a film lookup
// only suggests films. Returns the same shape as wikidataSearch, best first.
export async function wikidataSearchMedium(title, medium) {
  const filter = 'haswbstatement:' + MEDIUM_CLASSES[medium].map((q) => 'P31=' + q).join('|');
  const url = `https://www.wikidata.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(title + ' ' + filter)}&gsrlimit=8&prop=entityterms&wbetterms=label|description&wbetlanguage=en&format=json&origin=*`;
  const r = await wikiFetch(url);
  if (!r.ok) throw new Error('Wikidata search HTTP ' + r.status);
  const pages = Object.values(((await r.json()).query || {}).pages || {});
  return pages.sort((a, b) => (a.index || 0) - (b.index || 0)).map((p) => {
    const t = p.entityterms || {};
    return { id: p.title, label: (t.label && t.label[0]) || title, description: (t.description && t.description[0]) || '' };
  });
}

export function candidateMatchesMedium(c, medium) {
  const desc = (c.description || '').toLowerCase();
  return MEDIUM_KEYWORDS[medium].some((k) => desc.includes(k));
}

export async function wikidataGetEntity(qid) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|sitelinks&format=json&origin=*`;
  const r = await wikiFetch(url);
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

export function wikidataYear(entity, medium) {
  return firstClaimYear(entity && entity.claims, MEDIUM_PROPS[medium] && MEDIUM_PROPS[medium].date);
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
  const r = await wikiFetch(url);
  if (!r.ok) throw new Error('Wikidata labels HTTP ' + r.status);
  const d = await r.json();
  const out = {};
  unique.forEach((id) => {
    const ent = d.entities && d.entities[id];
    out[id] = ent && ent.labels && ent.labels.en ? ent.labels.en.value : id;
  });
  return out;
}

// Covers are credited only on the privacy page, so a Commons image is used only
// when its licence asks for no attribution (public domain, CC0). CC BY / BY-SA
// images would need the author named next to them.
async function commonsNeedsNoCredit(filename) {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=LicenseShortName&format=json&origin=*&titles=${encodeURIComponent('File:' + filename)}`;
    const r = await wikiFetch(url);
    if (!r.ok) return false;
    const page = Object.values(((await r.json()).query || {}).pages || {})[0];
    const lic = page && page.imageinfo && page.imageinfo[0].extmetadata.LicenseShortName;
    return !!lic && /^(public domain|pd\b|cc0|no restrictions)/i.test(lic.value);
  } catch (e) { return false; }
}

async function fetchWikipediaLeadImage(pageTitle) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
    const r = await wikiFetch(url);
    if (!r.ok) return '';
    const d = await r.json();
    const src = (d.originalimage && d.originalimage.source) || (d.thumbnail && d.thumbnail.source) || '';
    // Files local to English Wikipedia are non-free posters (fair use). Ones
    // from Commons are freely licensed and may need a credit, see below.
    const commons = src.match(/\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/);
    if (commons && !(await commonsNeedsNoCredit(decodeURIComponent(commons[1])))) return '';
    return src;
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

// Books only. Films and series have no fallback: the old one, iTunes artwork,
// may only be shown to promote the iTunes Store (#30).
async function fetchCoverFallback(medium, title, author) {
  if (medium !== 'book') return '';
  try {
    const q = encodeURIComponent(title + (author ? ' ' + author : ''));
    const r = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=1`);
    const d = await r.json();
    if (d.docs && d.docs[0] && d.docs[0].cover_i) return `https://covers.openlibrary.org/b/id/${d.docs[0].cover_i}-L.jpg`;
    return '';
  } catch (e) { return ''; }
}

export async function applyWikidataDetails(qid, form) {
  const entity = await wikidataGetEntity(qid);
  if (!entity) return false;
  const claims = entity.claims;
  const props = MEDIUM_PROPS[form.medium];
  let openlibraryId = '';
  if (form.medium === 'book') openlibraryId = openLibraryWork(claims) || await openLibrarySearchWork(form.title.trim(), form.author.trim());
  link(form, { wikidataId: qid, openlibraryId, musicbrainzId: '', itunesId: '' });

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
      img && (async () => (await commonsNeedsNoCredit(img)) ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=600` : ''),
      () => fetchCoverFallback(form.medium, title, form.author.trim()),
    ].filter(Boolean);
    const cover = await pickPortraitCover(sources);
    if (cover) form.coverUrl = cover;
  }
  return true;
}

// Find an album on MusicBrainz (#30; it replaced iTunes, whose artwork may only
// promote the iTunes Store). Music entries are albums: the release group's MBID
// is the id, and the Cover Art Archive serves its front cover. A hit counts when
// one title contains the other ("Ojos del Condor" = "Los Ojos Del Cóndor", "OK
// Computer OKNOTOK" = "OK Computer") and, if given, the artist matches.
// MusicBrainz allows about one request per second per IP.
// get(url) returns the parsed JSON.
const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`MusicBrainz HTTP ${r.status}`);
  return r.json();
};

export async function findMusicBrainzAlbum(title, artist, get = getJson) {
  const quote = (s) => `"${String(s).replace(/["\\]/g, ' ').trim()}"`;
  const query = `releasegroup:${quote(title)}` + (artist ? ` AND artist:${quote(artist)}` : '');
  const d = await get(`https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&limit=10&fmt=json`);
  const want = normText(title);
  const by = normText(artist);
  const fits = (g) => {
    const t = normText(g.title);
    const who = normText(((g['artist-credit'] || [])[0] || {}).name);
    return t && (t.includes(want) || want.includes(t)) && (!by || who.includes(by) || by.includes(who));
  };
  const groups = ((d && d['release-groups']) || []).filter(fits);
  return groups.find((g) => g['primary-type'] === 'Album') || groups[0] || null;
}

export const coverArtUrl = (mbid) => `https://coverartarchive.org/release-group/${mbid}/front-500`;

export async function applyMusicBrainzDetails(form) {
  const hit = await findMusicBrainzAlbum(form.title.trim(), form.author.trim());
  if (!hit) return false;
  link(form, { wikidataId: '', openlibraryId: '', musicbrainzId: hit.id, itunesId: '' });
  const credit = (hit['artist-credit'] || []).map((c) => c.name + (c.joinphrase || '')).join('');
  if (!form.author.trim() && credit) form.author = credit;
  if (!form.year.trim() && hit['first-release-date']) form.year = hit['first-release-date'].slice(0, 4);
  if (!form.coverUrl.trim() && await imageSize(coverArtUrl(hit.id))) form.coverUrl = coverArtUrl(hit.id);
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
      const filled = await applyMusicBrainzDetails(form);
      return {
        status: filled
          ? "Filled artist, year, and cover from MusicBrainz. Band members and the listen link aren't auto-filled — add those yourself."
          : 'No match found on MusicBrainz.',
      };
    } catch (e) {
      return { status: `Couldn't reach MusicBrainz — ${e && e.message ? e.message : e}.` };
    }
  }
  try {
    // Typed search first: every suggestion is of the right medium. One exact
    // title match is filled straight away; otherwise the user picks.
    const typed = await wikidataSearchMedium(title, form.medium);
    if (typed.length) {
      const exact = typed.filter((c) => normText(c.label) === normText(title));
      const only = typed.length === 1 ? typed[0] : exact.length === 1 ? exact[0] : null;
      if (only) {
        await applyWikidataDetails(only.id, form);
        return { status: `Filled from Wikidata (${only.label}).` };
      }
      return { choices: typed, uncertain: false };
    }
    // Nothing typed (items missing an "instance of" we know): plain search.
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
  { id: 'musicbrainz', name: 'MusicBrainz (music)', url: 'https://musicbrainz.org/ws/2/release-group?query=test&limit=1&fmt=json' },
  { id: 'tvmaze', name: 'TVmaze (series poster)', url: 'https://api.tvmaze.com/singlesearch/shows?q=girls' },
  { id: 'openlib', name: 'Open Library (book cover)', url: 'https://openlibrary.org/search.json?q=test&limit=1' },
];

export async function checkTarget(t) {
  const start = performance.now();
  try {
    const r = await fetch(t.url);
    return `${r.ok ? '✅' : '⚠️'} ${t.name}: HTTP ${r.status} (${Math.round(performance.now() - start)}ms)`;
  } catch (e) {
    return `❌ ${t.name}: ${e && e.message ? e.message : e}`;
  }
}

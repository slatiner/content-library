// Entry shape helpers shared by the views. The shape matches
// media-archive-data.example.json.

export const MEDIA = ['book', 'film', 'series', 'music'];

// Visibility levels (#20). An entry's '' follows the library default.
export const LEVELS = ['private', 'friends', 'public'];
export const LEVEL_LABEL = { private: 'Only me', friends: 'Friends', public: 'Public (members, and anyone with a link)' };
export const levelOf = (entry, libraryDefault) => entry.visibility || libraryDefault || 'private';
export const MEDIUM_PLURAL = { book: 'books', film: 'films', series: 'series', music: 'music' };
export const MEDIUM_TAG_LABEL = { book: 'Books', film: 'Films', series: 'Series', music: 'Music' };
// What "consumed" means for each medium, in the UI copy.
export const DONE_VERB = { book: 'Read', film: 'Watched', series: 'Watched', music: 'Listened' };

export const SORT_LABEL = {
  dateConsumed_desc: 'recently consumed',
  dateAdded_desc: 'recently added',
  rating_desc: 'highest rated',
  year_desc: 'newest release',
  title_asc: 'A–Z',
};

export function uid() {
  return 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export function emptyForm() {
  return {
    medium: 'book', title: '', year: '', author: '', director: '', cast: '',
    platform: '', streamUrl: '', dateConsumed: '', rating: 0, coverUrl: '', insights: '',
    visibility: '', // '' follows the library default (#20)
    // Canonical external ids (#26), kept but not shown. linkedFor is the
    // linkKey() they were found for; saving under another title or medium drops them.
    wikidataId: '', openlibraryId: '', itunesId: '', linkedFor: '',
  };
}

export const ID_FIELDS = ['wikidataId', 'openlibraryId', 'itunesId'];

// Lowercase letters and digits only, accents dropped ("Cóndor" = "condor"), for
// comparing titles and names.
export function normText(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// Title and medium, ignoring case and punctuation, so "paprika" still matches
// "Paprika" but "Paprika 2" doesn't.
export function linkKey({ title, medium }) {
  return `${medium}|${normText(title)}`;
}

export function personLine(e) {
  if (e.medium === 'book') return e.author || '';
  const parts = [];
  if (e.medium === 'music' && e.author) parts.push(e.author);
  if (e.director) parts.push(e.director);
  if (e.cast) parts.push(e.cast);
  return parts.join(' · ');
}

export function todayLocalIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function validIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) ? s : '';
}

export function countByMedium(entries) {
  const c = { book: 0, film: 0, series: 0, music: 0 };
  entries.forEach((e) => { if (c[e.medium] !== undefined) c[e.medium]++; });
  return c;
}

// The library view: filter by the controls (and Ask criteria), then sort.
export function filterAndSort(entries, f, askCriteria) {
  const search = (f.search || '').trim().toLowerCase();
  const visible = entries.filter((e) => {
    if (!f.mediums.includes(e.medium)) return false;
    if (f.dateFrom && (!e.dateConsumed || e.dateConsumed < f.dateFrom)) return false;
    if (f.dateTo && (!e.dateConsumed || e.dateConsumed > f.dateTo)) return false;
    if (askCriteria) {
      const { minRating, maxRating, releasedFrom, releasedTo } = askCriteria;
      const rt = e.rating || 0;
      if (minRating && rt < minRating) return false;
      if (maxRating && (rt < 1 || rt > maxRating)) return false;
      if (releasedFrom || releasedTo) {
        const y = parseInt(e.year);
        if (!y || (releasedFrom && y < releasedFrom) || (releasedTo && y > releasedTo)) return false;
      }
    }
    if (search) {
      const hay = [e.title, e.author, e.director, e.cast, e.insights].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const cmp = {
    dateConsumed_desc: (a, b) => (b.dateConsumed || '').localeCompare(a.dateConsumed || ''),
    dateAdded_desc: (a, b) => (b.dateAdded || 0) - (a.dateAdded || 0),
    rating_desc: (a, b) => (b.rating || 0) - (a.rating || 0),
    year_desc: (a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0),
    title_asc: (a, b) => (a.title || '').localeCompare(b.title || ''),
  }[f.sortBy];
  return cmp ? visible.sort(cmp) : visible;
}

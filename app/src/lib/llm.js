// The LLM calls behind "Describe it" and "Ask the library". The provider call is
// isolated in llmJson() so another provider (e.g. Gemini) can be swapped in.
import { todayLocalIso, validIsoDate, MEDIUM_PLURAL, SORT_LABEL } from './entries.js';

const GROQ_MODEL = 'openai/gpt-oss-20b';

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['add', 'other'] },
    medium: { type: 'string', enum: ['book', 'film', 'series', 'music'] },
    title: { type: 'string' },
    year: { type: ['string', 'null'] },
    creator: { type: ['string', 'null'] },
    rating: { type: ['integer', 'null'] },
    dateConsumed: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
    platform: { type: ['string', 'null'] },
    url: { type: ['string', 'null'] },
  },
  required: ['intent', 'medium', 'title', 'year', 'creator', 'rating', 'dateConsumed', 'note', 'platform', 'url'],
  additionalProperties: false,
};

function buildExtractPrompt() {
  return `You turn a casual message into one entry for a personal media library (things the user watched, read or listened to). Today's date is ${todayLocalIso()}. Reply with JSON only.

Rules:
- intent: "add" if the user is logging an item, otherwise "other" (then set medium "film" and title "").
- medium: "book", "film", "series" (TV show) or "music" (album, single, song or DJ set). Infer it when the user doesn't say.
- title: the work's proper title. Fix obvious typos and use normal capitalization (e.g. "moderless brooklyn" -> "Motherless Brooklyn"). Never put the year or creator inside the title.
- year: only if the user states it, otherwise null. Never guess.
- creator: only if the user states it (author for books, artist or band for music, director for films and series), with the spelling fixed. Otherwise null.
- rating: integer 1-5. Use the user's number; convert other scales (8/10 -> 4). If no rating is given, null.
- dateConsumed: YYYY-MM-DD, only when the user says when they finished it. Resolve relative phrases from today's date: "now", "just now", "today", "just saw it" -> today; "yesterday"; "last week" -> 7 days ago; "N weeks ago" -> N*7 days ago; "N months ago" -> same day-of-month N months earlier; "a year ago" -> same date one year earlier; "mid <month>" -> the 15th of the most recent such month that is not in the future; a bare month name -> the 15th of that month the same way. If no timing is mentioned, null.
- note: the user's own comment about the item, in their words, without the rating or date parts. Otherwise null.
- platform: where they watched it (Netflix, cinema...) if stated, otherwise null.
- url: a link the user pasted, otherwise null.`;
}

const FIND_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['find', 'add', 'other'] },
    mediums: { type: 'array', items: { type: 'string', enum: ['book', 'film', 'series', 'music'] } },
    text: { type: ['string', 'null'] },
    minRating: { type: ['integer', 'null'] },
    maxRating: { type: ['integer', 'null'] },
    consumedFrom: { type: ['string', 'null'] },
    consumedTo: { type: ['string', 'null'] },
    releasedFrom: { type: ['integer', 'null'] },
    releasedTo: { type: ['integer', 'null'] },
    sort: { type: ['string', 'null'] },
  },
  required: ['intent', 'mediums', 'text', 'minRating', 'maxRating', 'consumedFrom', 'consumedTo', 'releasedFrom', 'releasedTo', 'sort'],
  additionalProperties: false,
};

function buildFindPrompt() {
  return `You turn a question about a personal media library into filters. Today's date is ${todayLocalIso()}. Reply with JSON only.

The library holds books, films, series (TV shows) and music (albums, singles, DJ sets). Each item has a title, release year, author/artist/director, cast, the user's 1-5 star rating, the date the user consumed it, and the user's notes.

Rules:
- intent: "find" if the user wants to see or narrow down items in the library (a bare keyword or name counts). "add" if the user is logging something they watched, read or listened to, e.g. "just watched Dune, 4 stars", "add Perfect Blue", "finished Steppenwolf last week, loved it" (then set the other fields to null and mediums to []). Otherwise "other".
- mediums: the kinds to include, from "book", "film", "series", "music". An empty array means all kinds. "movies" -> film, "shows" -> series, "albums", "songs", "records", "sets" -> music, "read" suggests book, "listened" suggests music. Only restrict kinds when the user names or clearly implies them. Never guess a kind from a person's name: a bare name or keyword gets an empty array.
- text: names or keywords to look for in titles, people or notes (e.g. "Murakami", "Beatles"). Never include generic words such as "films", "rated", "this year". null if there are none.
- minRating / maxRating: inclusive, 1-5. "above 4" -> min 5; "4 or more", "at least 4", "4+" -> min 4; "below 3" -> max 2; "at most 3", "up to 3" -> max 3; "favorites" -> min 5; "good ones" -> min 4; "worst" or "bad ones" -> max 2. null if not about ratings. "highest rated" or "top rated" by themselves are an ordering (sort), not a rating filter.
- consumedFrom / consumedTo: YYYY-MM-DD, inclusive range for when the user watched, read or listened to it. "this year" -> Jan 1 to Dec 31 of this year; "last year"; "this month"; "last month"; "last week" -> the 7 days up to today; "recently" or "lately" -> the last 30 days; "in August" -> that month, the most recent one not in the future; "in 2025"; "since June" -> only consumedFrom; "before 2025" -> only consumedTo. null if the user says nothing about when they consumed it.
- releasedFrom / releasedTo: inclusive release years as integers, for "from the 90s" (1990, 1999), "released before 2000" (only releasedTo 1999), "newer than 2020", "from 1982". Only use these for when the work came out, not for when the user consumed it. null otherwise.
- sort: one of "dateConsumed_desc" (most recently consumed first), "dateAdded_desc" (recently added), "rating_desc" (highest rated first), "year_desc" (newest releases first), "title_asc" (alphabetical). Only when the user asks for an order; otherwise null.`;
}

// One call path for both tasks. A task is { name, schema, prompt() }.
export const ADD_TASK = { name: 'library_entry', schema: EXTRACT_SCHEMA, prompt: buildExtractPrompt };
export const FIND_TASK = { name: 'library_filter', schema: FIND_SCHEMA, prompt: buildFindPrompt };

// key is a Groq API key (file mode), or { url, headers } for the Supabase proxy
// (supabase/functions/groq), which holds the key server side.
async function groqRequest(key, text, temperature, task) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const err = new Error("You're offline. Check your connection and try again.");
    err.code = 'NETWORK';
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const proxy = typeof key === 'object';
    return await fetch(proxy ? key.url : 'https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(proxy ? key.headers : { Authorization: 'Bearer ' + key }) },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'system', content: task.prompt() }, { role: 'user', content: text }],
        temperature,
        reasoning_effort: 'medium',
        max_completion_tokens: 1500,
        response_format: { type: 'json_schema', json_schema: { name: task.name, strict: true, schema: task.schema } },
      }),
    });
  } catch (e) {
    const err = new Error(e && e.name === 'AbortError' ? 'Groq took too long to answer. Try again.' : "Couldn't reach Groq. Check your connection.");
    err.code = 'NETWORK';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// key: the Groq API key, the proxy endpoint, or null (throws code NO_KEY).
export async function llmJson(key, text, task) {
  if (!key) { const err = new Error('No API key'); err.code = 'NO_KEY'; throw err; }
  let r = await groqRequest(key, text, 0, task);
  if (r.status === 400) {
    // The small model occasionally returns an empty answer that fails strict-JSON validation; one retry with a little sampling noise clears it.
    const body = await r.clone().json().catch(() => null);
    if (body && body.error && body.error.code === 'json_validate_failed') r = await groqRequest(key, text, 0.3, task);
  }
  if (!r.ok) {
    if (typeof key === 'object' && r.status === 401) {
      const err = new Error('Your sign-in has expired. Reload the page and sign in again.');
      err.code = 'AUTH';
      throw err;
    }
    const err = new Error(
      r.status === 401 ? 'Groq rejected the API key.' :
      r.status === 403 ? 'Redeem an invite code to use the assistant.' :
      r.status === 502 ? 'The assistant\'s server key was rejected by Groq. Check GROQ_API_KEY in Supabase.' :
      r.status === 429 ? 'Groq rate limit reached (free tier). Wait a minute and try again.' :
      r.status >= 500 ? `Groq is having trouble right now (HTTP ${r.status}). Try again shortly.` :
      `Groq returned an error (HTTP ${r.status}).`
    );
    err.code = r.status;
    throw err;
  }
  try {
    const d = await r.json();
    return JSON.parse(d.choices[0].message.content);
  } catch (e) {
    const err = new Error("Groq's answer wasn't in the expected format. Try rephrasing.");
    err.code = 'PARSE';
    throw err;
  }
}

// Fill a form object from an ADD_TASK extraction.
export function fillFormFromExtraction(form, r) {
  const creator = (r.creator || '').trim();
  form.medium = r.medium;
  form.title = r.title.trim();
  form.year = (r.year || '').trim();
  form.author = (r.medium === 'book' || r.medium === 'music') ? creator : '';
  form.director = (r.medium === 'film' || r.medium === 'series') ? creator : '';
  form.cast = '';
  form.platform = (r.medium === 'film' || r.medium === 'series') ? (r.platform || '').trim() : '';
  form.streamUrl = r.medium === 'music' ? (r.url || '').trim() : '';
  form.dateConsumed = validIsoDate(r.dateConsumed);
  form.coverUrl = '';
  form.insights = (r.note || '').trim();
  form.rating = Math.max(0, Math.min(5, Math.round(Number(r.rating) || 0)));
}

export function normalizeFind(r) {
  const rating = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : null; };
  const year = (v) => { const n = Math.round(Number(v)); return n >= 1000 && n <= 2200 ? n : null; };
  const ordered = (a, b) => (a !== null && a !== '' && b !== null && b !== '' && a > b) ? [b, a] : [a, b];
  const [minRating, maxRating] = ordered(rating(r.minRating), rating(r.maxRating));
  const [consumedFrom, consumedTo] = ordered(validIsoDate(r.consumedFrom), validIsoDate(r.consumedTo));
  const [releasedFrom, releasedTo] = ordered(year(r.releasedFrom), year(r.releasedTo));
  return {
    mediums: (Array.isArray(r.mediums) ? r.mediums : []).filter((m) => MEDIUM_PLURAL[m]),
    text: typeof r.text === 'string' ? r.text.trim() : '',
    minRating, maxRating, consumedFrom, consumedTo, releasedFrom, releasedTo,
    sort: SORT_LABEL[r.sort] ? r.sort : null,
  };
}

export function askChipsFor(f) {
  const chips = [];
  if (f.mediums.length) chips.push(f.mediums.map((m) => MEDIUM_PLURAL[m]).join(' + '));
  if (f.minRating && f.maxRating) chips.push(f.minRating === f.maxRating ? `rated ${f.minRating}` : `rated ${f.minRating}–${f.maxRating}`);
  else if (f.minRating) chips.push(`rated ${f.minRating}+`);
  else if (f.maxRating) chips.push(`rated up to ${f.maxRating}`);
  if (f.consumedFrom && f.consumedTo) chips.push(`finished ${f.consumedFrom} → ${f.consumedTo}`);
  else if (f.consumedFrom) chips.push(`finished since ${f.consumedFrom}`);
  else if (f.consumedTo) chips.push(`finished until ${f.consumedTo}`);
  if (f.releasedFrom && f.releasedTo) chips.push(`released ${f.releasedFrom}–${f.releasedTo}`);
  else if (f.releasedFrom) chips.push(`released ${f.releasedFrom} or later`);
  else if (f.releasedTo) chips.push(`released ${f.releasedTo} or earlier`);
  if (f.text) chips.push(`“${f.text}”`);
  if (f.sort) chips.push(`sorted: ${SORT_LABEL[f.sort]}`);
  if (!chips.length) chips.push('everything');
  return chips;
}

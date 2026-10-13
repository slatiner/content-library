// Tests for the iTunes album matching, with a fake network.
import { describe, it, expect } from 'vitest';
import { findItunesAlbum } from './lookup.js';

const album = (collectionName, artistName, collectionId) => ({ wrapperType: 'collection', collectionName, artistName, collectionId });
const song = (collectionName, artistName, collectionId) => ({ wrapperType: 'track', trackName: 'x', collectionName, artistName, collectionId });

function fakeGet(albums, songs) {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    return { results: url.includes('entity=album') ? albums : songs };
  };
  return { get, calls };
}

describe('findItunesAlbum', () => {
  it('skips albums whose title does not match, then finds the album through its songs', async () => {
    const { get, calls } = fakeGet(
      [album('Comedown Machine', 'The Strokes', 1), album('Angles', 'The Strokes', 2)],
      [song('Reality Awaits', 'The Strokes', 3)],
    );
    const hit = await findItunesAlbum('Reality Awaits', 'The Strokes', get);
    expect(hit.collectionId).toBe(3);
    expect(calls).toHaveLength(2);
  });

  it('takes a matching album without searching songs, allowing editions', async () => {
    const { get, calls } = fakeGet([album('OK Computer OKNOTOK 1997 2017', 'Radiohead', 7)], []);
    expect((await findItunesAlbum('ok computer', 'radiohead', get)).collectionId).toBe(7);
    expect(calls).toHaveLength(1);
  });

  it('respects the artist when one is given', async () => {
    const { get } = fakeGet([album('Reality Awaits', 'Purple Fog Side', 4)], [song('Reality Awaits', 'The Strokes', 3)]);
    expect((await findItunesAlbum('Reality Awaits', 'The Strokes', get)).collectionId).toBe(3);
  });

  it('ignores accents in titles and artists', async () => {
    const { get } = fakeGet([album('Los Ojos Del Cóndor', 'Hermanos Gutiérrez', 5)], []);
    expect((await findItunesAlbum('los ojos del condor', 'Hermanos Gutierrez', get)).collectionId).toBe(5);
  });

  it('returns null when nothing matches', async () => {
    const { get } = fakeGet([album('Angles', 'The Strokes', 2)], [song('Angles', 'The Strokes', 2)]);
    expect(await findItunesAlbum('Reality Awaits', 'The Strokes', get)).toBe(null);
  });
});

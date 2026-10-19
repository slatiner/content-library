// Tests for the MusicBrainz album matching (#30), with a fake network.
import { describe, it, expect } from 'vitest';
import { findMusicBrainzAlbum } from './lookup.js';

const group = (title, artist, id, type = 'Album') => ({ id, title, 'primary-type': type, 'artist-credit': [{ name: artist }] });

function fakeGet(groups) {
  const calls = [];
  const get = async (url) => { calls.push(decodeURIComponent(url)); return { 'release-groups': groups }; };
  return { get, calls };
}

describe('findMusicBrainzAlbum', () => {
  it('searches by title and artist and takes the matching album', async () => {
    const { get, calls } = fakeGet([group('Comedown Machine', 'The Strokes', 'a1'), group('Reality Awaits', 'The Strokes', 'a2')]);
    expect((await findMusicBrainzAlbum('Reality Awaits', 'The Strokes', get)).id).toBe('a2');
    expect(calls[0]).toContain('releasegroup:"Reality Awaits" AND artist:"The Strokes"');
  });

  it('accepts titles that contain each other, ignoring accents', async () => {
    const { get } = fakeGet([group('Los Ojos Del Cóndor', 'Hermanos Gutiérrez', 'c1')]);
    expect((await findMusicBrainzAlbum('Ojos del Condor', 'Hermanos Gutierrez', get)).id).toBe('c1');
    const { get: get2 } = fakeGet([group('OK Computer OKNOTOK 1997 2017', 'Radiohead', 'r1')]);
    expect((await findMusicBrainzAlbum('ok computer', 'radiohead', get2)).id).toBe('r1');
  });

  it('respects the artist and prefers albums over singles', async () => {
    const { get } = fakeGet([
      group('Reality Awaits', 'Purple Fog Side', 'x'),
      group('Reality Awaits', 'The Strokes', 's', 'Single'),
      group('Reality Awaits', 'The Strokes', 'a'),
    ]);
    expect((await findMusicBrainzAlbum('Reality Awaits', 'The Strokes', get)).id).toBe('a');
  });

  it('keeps quotes in a title from breaking the query', async () => {
    const { get, calls } = fakeGet([]);
    expect(await findMusicBrainzAlbum('Say "Hi"', '', get)).toBe(null);
    expect(calls[0]).toContain('releasegroup:"Say  Hi"');
    expect(calls[0]).not.toContain('artist:');
  });
});

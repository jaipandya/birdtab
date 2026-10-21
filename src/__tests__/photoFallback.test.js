/**
 * Photo fallback (photoFallback.js) and the media cache it relies on
 * (mediaCache.js): a new tab always gets a bird whose photo can be shown.
 */

jest.mock('../historyModal.js', () => ({ getHistory: jest.fn() }));
jest.mock('../mediaClient.js', () => ({ getBundledBird: jest.fn() }));
jest.mock('../logger.js', () => ({ log: jest.fn() }));

import { getHistory } from '../historyModal.js';
import { getBundledBird } from '../mediaClient.js';
import {
  resolveShownBird,
  isMediaUnreachable,
  MEDIA_UNREACHABLE_MS,
  PHOTO_DECIDE_MS,
  PHOTO_ANSWER_TIMEOUT_MS,
} from '../photoFallback.js';
import {
  cacheMediaFile,
  downloadMediaFile,
  forgetCachedMedia,
  resolveMediaUrl,
  revokeMediaUrls,
} from '../mediaCache.js';

const MEDIA = 'https://media.birdtab.app/assets';
const bird = (code, extra = {}) => ({
  speciesCode: code,
  name: `Bird ${code}`,
  imageUrl: `${MEDIA}/images/${code}.avif`,
  mediaUrl: `${MEDIA}/audio/${code}.opus`,
  ...extra,
});
const BUNDLED = { speciesCode: 'bundled', name: 'Bundled bird', imageUrl: 'images/bundled-birds/b.webp', mediaUrl: `${MEDIA}/audio/b.opus` };

// Cache Storage, in memory
let store;
function installCaches() {
  store = new Map();
  const cache = {
    match: jest.fn(async (url) => store.get(url)),
    put: jest.fn(async (url, response) => {
      if (response.body) await response.body; // a slow or broken download
      store.set(url, response);
    }),
    delete: jest.fn(async (url) => store.delete(url)),
    keys: jest.fn(async () => [...store.keys()].map(url => ({ url }))),
  };
  global.caches = { open: jest.fn(async () => cache), delete: jest.fn() };
}

function response({ ok = true, status = 200, type = 'image/avif', redirected = false, body } = {}) {
  return {
    ok,
    status,
    redirected,
    body,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
    blob: async () => new Blob(['photo']),
  };
}
const networkError = () => Promise.reject(new TypeError('Failed to fetch'));
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
// A server that never answers (aborted by the caller's signal)
const hang = (url, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(abortError()));
});
// A server that answers after ms
const answerAfter = (ms) => () => new Promise(resolve => setTimeout(() => resolve(response()), ms));

let session;
let online;
let history;

beforeEach(() => {
  jest.useRealTimers();
  installCaches();
  session = {};
  chrome.storage.session = {
    get: jest.fn(async (key) => ({ [key]: session[key] })),
    set: jest.fn(async (items) => { Object.assign(session, items); }),
  };
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  history = [];
  getHistory.mockImplementation(async () => history);
  getBundledBird.mockImplementation(() => ({ ...BUNDLED }));
  global.fetch = jest.fn(async () => response());
  global.URL.createObjectURL = jest.fn(() => 'blob:photo');
  global.URL.revokeObjectURL = jest.fn();
  revokeMediaUrls();
});

const cachePhoto = (b) => store.set(b.imageUrl, response());
const seen = (...birds) => { history = birds.map((b, i) => ({ ...b, timestamp: 1000 + i })); };

describe('the picked bird stays', () => {
  test('when its photo is cached, without touching the network', async () => {
    const picked = bird('robin');
    cachePhoto(picked);
    const result = await resolveShownBird(picked);
    expect(result).toEqual({ bird: picked, fallback: null, mediaUnreachable: false, photo: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('when its photo ships with the extension', async () => {
    const result = await resolveShownBird({ ...BUNDLED });
    expect(result.bird.speciesCode).toBe('bundled');
    expect(result.fallback).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('when the user picked it (History, Your Birds), even offline', async () => {
    online = false;
    seen(bird('wren'));
    cachePhoto(bird('wren'));
    const picked = bird('robin');
    const result = await resolveShownBird(picked, { chosen: true });
    expect(result.bird).toBe(picked);
    expect(result.fallback).toBeNull();
    expect(result.mediaUnreachable).toBe(true);
  });

  test('when its photo downloads: drawn at once, the photo from that one download', async () => {
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    expect(result).toMatchObject({ bird: picked, fallback: null, mediaUnreachable: false });
    expect(await result.photo).toBe('cached');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.has(picked.imageUrl)).toBe(true);
  });

  test('after one failed request, when the retry works', async () => {
    fetch.mockImplementationOnce(networkError);
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    expect(result.bird).toBe(picked);
    expect(result.fallback).toBeNull();
    expect(await result.photo).toBe('cached');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await isMediaUnreachable()).toBe(false);
  });

  test('slow connection, slow to answer: drawn within the decision time, photo when it comes', async () => {
    jest.useFakeTimers();
    fetch.mockImplementation(answerAfter(3000));
    const picked = bird('robin');
    const pending = resolveShownBird(picked);
    await jest.advanceTimersByTimeAsync(PHOTO_DECIDE_MS);
    const result = await pending;
    expect(result).toMatchObject({ bird: picked, fallback: null, mediaUnreachable: false });
    await jest.advanceTimersByTimeAsync(3000);
    expect(await result.photo).toBe('cached');
    expect(await isMediaUnreachable()).toBe(false);
  });

  test('slow connection, slow photo: never cut off once the server answered', async () => {
    jest.useFakeTimers();
    let finish;
    const body = new Promise(resolve => { finish = resolve; });
    fetch.mockImplementation(async () => response({ body }));
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    expect(result.bird).toBe(picked);
    let photo = 'pending';
    result.photo.then(r => { photo = r; });
    await jest.advanceTimersByTimeAsync(PHOTO_ANSWER_TIMEOUT_MS * 5);
    expect(photo).toBe('pending');
    finish();
    expect(await result.photo).toBe('cached');
  });

  test('a download that breaks off after the answer: not an outage', async () => {
    fetch.mockImplementation(async () => response({ body: Promise.reject(new TypeError('connection reset')) }));
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    expect(result.bird).toBe(picked);
    expect(await result.photo).toBe('network');
    expect(await isMediaUnreachable()).toBe(false);
  });

  test('when there is no Cache Storage: the page loads the photo itself', async () => {
    delete global.caches;
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    expect(result.bird).toBe(picked);
    expect(result.fallback).toBeNull();
  });
});

describe('another bird is shown when the photo can\'t be had', () => {
  test('offline: a recent bird with a cached photo, without trying the network', async () => {
    online = false;
    const wren = bird('wren');
    seen(wren);
    cachePhoto(wren);
    const result = await resolveShownBird(bird('robin'));
    expect(result.bird).toEqual(wren); // the history timestamp is dropped
    expect(result.bird.timestamp).toBeUndefined();
    expect(result.fallback).toBe('offline');
    expect(result.mediaUnreachable).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('offline with no cached photos: the picked bird stays, for the offline notice', async () => {
    online = false;
    seen(bird('wren'));
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    // The page shows "you're offline" and loads the photo on reconnecting
    expect(result).toEqual({ bird: picked, fallback: null, mediaUnreachable: true, photo: null });
    expect(getBundledBird).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('media unreachable with no cached photos: a bundled bird', async () => {
    session.photoFallback = { unreachableUntil: Date.now() + 60000 };
    seen(bird('wren'));
    const result = await resolveShownBird(bird('robin'));
    expect(result.bird.speciesCode).toBe('bundled');
    expect(result.fallback).toBe('unreachable');
    // Recent birds, the failed one and the last fallback are avoided among bundled birds
    const excluded = getBundledBird.mock.calls[0][0];
    expect([...excluded]).toEqual(expect.arrayContaining(['wren', 'robin']));
  });

  test('requests keep failing: fallback, and later tabs skip the network for a while', async () => {
    fetch.mockImplementation(networkError);
    const wren = bird('wren');
    seen(wren);
    cachePhoto(wren);

    const first = await resolveShownBird(bird('robin'));
    expect(first.bird.speciesCode).toBe('wren');
    expect(first.fallback).toBe('unreachable');
    expect(first.mediaUnreachable).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await isMediaUnreachable()).toBe(true);

    const second = await resolveShownBird(bird('finch'));
    expect(second.fallback).toBe('unreachable');
    expect(fetch).toHaveBeenCalledTimes(2); // no new request

    // A bird whose photo is cached (the ready queue) still shows during the outage,
    // and is told media is out of reach so an uncached song isn't offered
    const queued = bird('jay');
    cachePhoto(queued);
    const third = await resolveShownBird(queued);
    expect(third).toEqual({ bird: queued, fallback: null, mediaUnreachable: true, photo: null });
  });

  test('the network is tried again once the outage window has passed', async () => {
    session.photoFallback = { unreachableUntil: Date.now() - 1 };
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    expect(result.bird).toBe(picked);
    await result.photo;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('an error status: no retry, fallback, outage window set', async () => {
    fetch.mockImplementation(async () => response({ ok: false, status: 503, type: 'text/html' }));
    const result = await resolveShownBird(bird('robin'));
    expect(result.fallback).toBe('unreachable');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.photoFallback.unreachableUntil).toBeGreaterThan(Date.now() + MEDIA_UNREACHABLE_MS - 5000);
  });

  test('a captive portal page instead of the photo: not cached, fallback', async () => {
    fetch.mockImplementation(async () => response({ type: 'text/html; charset=utf-8', redirected: true }));
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    expect(result.fallback).toBe('unreachable');
    expect(store.has(picked.imageUrl)).toBe(false);
  });

  test('no answer at all (media hanging): drawn, then the notice; twice means an outage', async () => {
    jest.useFakeTimers();
    fetch.mockImplementation(hang);
    const first = resolveShownBird(bird('robin'));
    await jest.advanceTimersByTimeAsync(PHOTO_DECIDE_MS);
    const tab1 = await first;
    expect(tab1.bird.speciesCode).toBe('robin'); // drawn, not held up
    await jest.advanceTimersByTimeAsync(PHOTO_ANSWER_TIMEOUT_MS);
    expect(await tab1.photo).toBe('no-answer');
    expect(await isMediaUnreachable()).toBe(false); // once could be the connection

    const second = resolveShownBird(bird('finch'));
    await jest.advanceTimersByTimeAsync(PHOTO_DECIDE_MS + PHOTO_ANSWER_TIMEOUT_MS);
    expect(await (await second).photo).toBe('no-answer');
    expect(await isMediaUnreachable()).toBe(true);

    const wren = bird('wren');
    seen(wren);
    cachePhoto(wren);
    const third = await resolveShownBird(bird('jay'));
    expect(third.fallback).toBe('unreachable');
    expect(third.bird.speciesCode).toBe('wren');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('a photo that arrives clears an earlier hang', async () => {
    jest.useFakeTimers();
    fetch.mockImplementationOnce(hang);
    const first = resolveShownBird(bird('robin'));
    await jest.advanceTimersByTimeAsync(PHOTO_DECIDE_MS + PHOTO_ANSWER_TIMEOUT_MS);
    expect(await (await first).photo).toBe('no-answer');
    const second = await resolveShownBird(bird('finch'));
    expect(await second.photo).toBe('cached');
    expect(session.photoFallback.hungAt).toBe(0);
  });
});

describe('which bird is shown instead', () => {
  test('never the bird whose photo failed', async () => {
    online = false;
    const robin = bird('robin');
    seen(robin);
    cachePhoto(robin);
    const result = await resolveShownBird(robin, {});
    // robin's photo is cached, so it simply stays
    expect(result.bird).toBe(robin);

    store.delete(robin.imageUrl);
    const other = bird('wren');
    seen(robin, other);
    cachePhoto(other);
    const fallback = await resolveShownBird(bird('robin'));
    expect(fallback.bird.speciesCode).toBe('wren');
  });

  test('not the last tab\'s bird or the last fallback when there is a choice', async () => {
    online = false;
    const [a, b, c] = [bird('a'), bird('b'), bird('c')];
    seen(a, b, c); // c was on the last tab
    [a, b, c].forEach(cachePhoto);
    session.photoFallback = { lastFallbackCode: 'a' };
    for (let i = 0; i < 5; i++) {
      const result = await resolveShownBird(bird('x'));
      expect(result.bird.speciesCode).toBe('b');
      session.photoFallback = { lastFallbackCode: 'a' };
    }
  });

  test('consecutive fallbacks alternate rather than repeat', async () => {
    online = false;
    const [a, b] = [bird('a'), bird('b')];
    seen(a, b, bird('last'));
    [a, b].forEach(cachePhoto);
    const first = await resolveShownBird(bird('x'));
    const second = await resolveShownBird(bird('y'));
    expect(first.bird.speciesCode).not.toBe(second.bird.speciesCode);
  });

  test('repeats one bird rather than none when it is the only cached one', async () => {
    online = false;
    const only = bird('only');
    seen(only);
    cachePhoto(only);
    session.photoFallback = { lastFallbackCode: 'only' };
    const result = await resolveShownBird(bird('x'));
    expect(result.bird.speciesCode).toBe('only');
  });

  test('history entries without a photo URL are skipped', async () => {
    session.photoFallback = { unreachableUntil: Date.now() + 60000 };
    history = [{ speciesCode: 'old', name: 'Old entry' }];
    const result = await resolveShownBird(bird('x'));
    expect(result.bird.speciesCode).toBe('bundled');
  });
});

describe('nothing stored yet (the page shows a bundled bird)', () => {
  test('online: left to the page', async () => {
    const result = await resolveShownBird(null);
    expect(result).toEqual({ bird: null, fallback: null, mediaUnreachable: false, photo: null });
  });

  test('offline: a recent bird with a cached photo when there is one', async () => {
    online = false;
    const wren = bird('wren');
    seen(wren);
    cachePhoto(wren);
    const result = await resolveShownBird(null);
    expect(result.bird.speciesCode).toBe('wren');
    expect(result.fallback).toBe('offline');
  });
});

describe('never in the way', () => {
  test('an unexpected error keeps the picked bird', async () => {
    online = false;
    getHistory.mockImplementation(async () => { throw new Error('storage gone'); });
    const picked = bird('robin');
    const result = await resolveShownBird(picked);
    expect(result).toEqual({ bird: picked, fallback: null, mediaUnreachable: true, photo: null });
  });

  test('works without session storage (local storage instead)', async () => {
    delete chrome.storage.session;
    const local = {};
    chrome.storage.local = {
      get: jest.fn(async (key) => ({ [key]: local[key] })),
      set: jest.fn(async (items) => { Object.assign(local, items); }),
    };
    fetch.mockImplementation(async () => response({ ok: false, status: 500 }));
    await resolveShownBird(bird('robin'));
    expect(local.photoFallback.unreachableUntil).toBeGreaterThan(Date.now());
  });
});

describe('media cache', () => {
  test('caches media files, not pages that stand in for them', async () => {
    expect(await cacheMediaFile(`${MEDIA}/a.avif`)).toBe(true);
    fetch.mockImplementation(async () => response({ type: 'text/html' }));
    expect(await cacheMediaFile(`${MEDIA}/b.avif`)).toBe(false);
    fetch.mockImplementation(async () => response({ type: 'application/json' }));
    expect(await cacheMediaFile(`${MEDIA}/c.avif`)).toBe(false);
    fetch.mockImplementation(async () => response({ redirected: true }));
    expect(await cacheMediaFile(`${MEDIA}/d.avif`)).toBe(false);
    fetch.mockImplementation(async () => response({ type: 'application/octet-stream' }));
    expect(await cacheMediaFile(`${MEDIA}/e.avif`)).toBe(true);
    expect([...store.keys()]).toEqual([`${MEDIA}/a.avif`, `${MEDIA}/e.avif`]);
  });

  test('says why a download failed', async () => {
    fetch.mockImplementation(networkError);
    expect(await downloadMediaFile(`${MEDIA}/a.avif`)).toBe('network');
    fetch.mockImplementation(async () => response({ ok: false, status: 404 }));
    expect(await downloadMediaFile(`${MEDIA}/a.avif`)).toBe('http');
    fetch.mockImplementation(async () => response({ type: 'text/html' }));
    expect(await downloadMediaFile(`${MEDIA}/a.avif`)).toBe('not-media');
    const controller = new AbortController();
    controller.abort();
    fetch.mockImplementation(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    expect(await downloadMediaFile(`${MEDIA}/a.avif`, { signal: controller.signal })).toBe('aborted');
    delete global.caches;
    expect(await downloadMediaFile(`${MEDIA}/a.avif`)).toBe('unavailable');
  });

  test('forgets a broken cached photo and its blob URL', async () => {
    const url = `${MEDIA}/a.avif`;
    store.set(url, response());
    expect(await resolveMediaUrl(url)).toBe('blob:photo');
    expect(await forgetCachedMedia(url)).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
    expect(store.has(url)).toBe(false);
    // Next time the page loads it from the network
    expect(await resolveMediaUrl(url)).toBe(url);
    expect(await forgetCachedMedia('images/bundled-birds/b.webp')).toBe(false);
  });
});

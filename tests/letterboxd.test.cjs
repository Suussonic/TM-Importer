const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DOMParser, parseHTML } = require('linkedom');

const root = path.resolve(__dirname, '..');
const pageUrl = 'https://letterboxd.com/tester/films/';
const posterUrl = 'https://a.ltrbxd.com/resized/test-poster.jpg';
const source = (file) => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
const load = (sandbox, file) => vm.runInContext(source(file), sandbox, { filename: path.join(root, ...file.split('/')) });
const plain = (value) => JSON.parse(JSON.stringify(value));
const profile = { id: 'member:tester', type: 'member', slug: 'tester', canonicalUrl: 'https://letterboxd.com/tester/', title: 'Test Member' };
const director = { id: 'director:alex-test', type: 'director', slug: 'alex-test', canonicalUrl: 'https://letterboxd.com/director/alex-test/', title: 'Alex Test' };

function filmRow(slug = 'sample', extra = '') {
  return `<li class="griditem">
    <div data-item-slug="${slug}" data-item-name="Sample &amp; Film (2020)">
      <img src="https://s.ltrbxd.com/static/img/empty-poster.png" alt="Sample">
    </div>
    <p class="poster-viewingdata">${extra}</p>
  </li>`;
}
function catalog(rows = filmRow(), next = '') {
  return `<html><head><title>Films</title></head><body><div class="poster-grid"><ul>${rows}</ul></div>
    ${next ? `<a class="next" href="${next}">Next</a>` : ''}</body></html>`;
}
function filmDetails(extra = {}, before = '') {
  const data = {
    '@type': 'Movie', name: 'Sample & Film', url: 'https://letterboxd.com/film/sample/',
    image: posterUrl, datePublished: '2020-01-01', duration: 'PT1H30M',
    aggregateRating: { ratingValue: 4, bestRating: 5 },
    genre: ['Drama', 'Comedy'], director: [{ name: 'Alex Test' }], actor: [{ name: 'Chris Example' }],
    countryOfOrigin: [{ name: 'France' }], inLanguage: ['fr'], ...extra
  };
  return `<html><head><title>Sample Film</title></head><body>${before}
    <script type="application/ld+json">/* <![CDATA[ */${JSON.stringify(data)}/* ]]> */</script>
    <a href="/films/language/french/">French</a></body></html>`;
}
function harness(respond = async () => ({}), initial = {}) {
  const data = structuredClone(initial);
  const calls = [];
  const sandbox = vm.createContext({
    DOMParser, URL, AbortSignal, Response, Uint8Array, btoa, console,
    setTimeout: (callback) => callback(),
    chrome: {
      runtime: {
        getURL: (url) => `chrome-extension://test/${url}`,
        sendMessage(message, callback) {
          calls.push(message);
          Promise.resolve().then(() => respond(message.type, message.payload))
            .then(callback, (error) => callback({ error: error.message }));
        }
      },
      storage: {
        local: {
          get(key, callback) { callback({ [key]: structuredClone(data[key]) }); },
          set(values, callback) { Object.assign(data, structuredClone(values)); callback(); }
        }
      }
    }
  });
  for (const file of [
    'lib/storage.js', 'letterboxd/client/letterboxd-parser.js',
    'letterboxd/client/letterboxd-filters.js', 'letterboxd/client/letterboxd-client.js'
  ]) load(sandbox, file);
  return {
    sandbox, data, calls, parser: sandbox.TMLetterboxdParser,
    filters: sandbox.TMLetterboxdFilters, client: sandbox.TMLetterboxdClient, storage: sandbox.TMStorage
  };
}

test('1.1.0 manifest and worker wire all Letterboxd files and only required hosts', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.equal(manifest.version, '1.1.0');
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js);
  assert.ok(scripts.includes('letterboxd/client/letterboxd-parser.js'));
  assert.ok(scripts.indexOf('letterboxd/client/letterboxd-filters.js') < scripts.indexOf('content/state/content-state.js'));
  for (const file of [...scripts, ...manifest.content_scripts.flatMap((entry) => entry.css)]) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  for (const host of ['letterboxd.com', 'a.ltrbxd.com', 's.ltrbxd.com']) {
    assert.ok(manifest.host_permissions.includes(`https://${host}/*`));
  }
  assert.match(source('background/background.js'), /TMLetterboxdBackground.handlers/);
  assert.doesNotMatch(source('letterboxd/background/letterboxd-background.js'), /api\.letterboxd|Authorization|Cookie:/);
});

test('normalizes exact accounts, director names and canonical URLs without ambiguous searches', () => {
  const { parser } = harness();
  assert.equal(parser.normalizeProfile('@Tester').id, profile.id);
  assert.equal(parser.normalizeProfile('Alex Test', 'director').id, director.id);
  assert.equal(parser.normalizeProfile(director.canonicalUrl).type, 'director');
  assert.equal(parser.normalizeProfile('https://www.letterboxd.com/tester/').id, profile.id);
  for (const input of [
    'https://example.com/tester/', 'http://letterboxd.com/tester/',
    'https://user:password@letterboxd.com/tester/', 'https://letterboxd.com/film/sample/',
    'https://letterboxd.com/tester/film/sample/', 'https://letterboxd.com/tester/?x=1',
    'https://letterboxd.com:999/tester/', '../tester', '', 'two names'
  ]) assert.throws(() => parser.normalizeProfile(input), undefined, input);
});

test('resolves and verifies public profiles instead of saving guessed names', async () => {
  const { client } = harness(async (_, { url }) => ({
    html: url === director.canonicalUrl
      ? '<html><head><meta property="og:title" content="Films directed by Alex Test"></head><body><div class="poster-grid"></div></body></html>'
      : '<html><head><title>Profile</title></head><body><h1 class="profile-name">Test Member</h1></body></html>'
  }));
  assert.equal((await client.resolveInput('tester', 'member')).title, 'Test Member');
  assert.equal((await client.resolveInput('Alex Test', 'director')).title, 'Alex Test');
  assert.throws(() => harness().parser.parseProfile('<title>Unknown</title>', profile), /introuvable/);
});

test('profile images use member avatars and lazy TMDB director portraits, not generic share images', () => {
  const { parser } = harness();
  const avatar = 'https://a.ltrbxd.com/resized/avatar/test.jpg';
  const portrait = 'https://image.tmdb.org/t/p/w500/director.jpg';
  const memberHtml = `<html><head><title>Member</title><meta property="og:image" content="https://s.ltrbxd.com/default-share.png"></head>
    <body><header class="profile-header"><a class="avatar"><img src="${avatar}"></a><h1 class="profile-name">Member</h1></header></body></html>`;
  const directorHtml = `<html><head><meta property="og:title" content="Films directed by Alex Test"></head>
    <body><figure class="contributor-image"><img src="https://s.ltrbxd.com/static/img/empty-test.png" data-image="${portrait}"></figure>
    <div class="poster-grid"></div></body></html>`;
  assert.equal(parser.parseProfile(memberHtml, profile).avatar, avatar);
  assert.equal(parser.parseProfile(directorHtml, director).avatar, portrait);
  assert.equal(parser.parseProfile(directorHtml.replace(` data-image="${portrait}"`, ''), director).avatar, '');
  assert.equal(parser.parseProfile(memberHtml.replace(avatar, 'https://evil.com/avatar.jpg'), profile).avatar, '');
  assert.equal(parser.parseProfile(memberHtml.replace(avatar, 'http://a.ltrbxd.com/avatar.jpg'), profile).avatar, '');
  const page = parser.parseCatalog(memberHtml.replace('</body>', `<main id="content">${catalog()}</main></body>`),
    pageUrl, 'watched', 'member');
  assert.equal(page.avatar, avatar);
});

test('reload updates missing member avatars and director portraits for already saved sources', async () => {
  for (const saved of [profile, director]) {
    const avatar = saved.type === 'member' ? 'https://a.ltrbxd.com/resized/avatar/test.jpg' : 'https://image.tmdb.org/t/p/w500/director.jpg';
    const header = saved.type === 'member'
      ? `<header class="profile-header"><a class="avatar"><img src="${avatar}"></a></header>`
      : `<figure class="contributor-image"><img data-image="${avatar}"></figure>`;
    const h = actionsHarness({ tm_letterboxd_profiles: { [saved.id]: { ...saved, avatar: '' } } },
      async () => ({ html: catalog().replace('<body>', `<body>${header}`) }));
    await h.ui.handleReload({}, saved.id, saved.title);
    assert.equal(h.errors.length, 0);
    assert.equal(h.data.tm_letterboxd_profiles[saved.id].avatar, avatar);
    assert.equal(h.data.tm_letterboxd_profiles[saved.id].title, saved.title);
  }
});

test('parses current film grids, half-star notes and likes without mistaking lazy placeholders for posters', () => {
  const { parser } = harness();
  const page = parser.parseCatalog(catalog(filmRow('sample', '<span class="rating rated-7"></span><span class="icon-liked"></span>'),
    '/tester/films/page/2/'), pageUrl, 'watched', 'member');
  assert.equal(page.items[0].id, 'sample');
  assert.equal(page.items[0].name, 'Sample & Film');
  assert.equal(page.items[0].year, 2020);
  assert.equal(page.items[0].rating, 3.5);
  assert.equal(page.items[0].liked, true);
  assert.equal(page.items[0].posterUrl, undefined);
  assert.equal(page.nextUrl, pageUrl + 'page/2/');
  const watchlist = parser.parseCatalog(catalog(), pageUrl, 'watchlist', 'member');
  assert.equal(watchlist.items[0].liked, null);
  assert.equal(watchlist.items[0].rating, null);
});

test('parses legacy posters and current review articles with SVG stars and entry likes', () => {
  const { parser } = harness();
  const legacy = '<ul class="poster-list"><li class="poster-container"><div data-film-slug="sample" data-film-name="Sample (2001)"></div><span class="rating rated-10"></span></li></ul>';
  assert.equal(parser.parseCatalog(legacy, pageUrl, 'watched', 'member').items[0].rating, 5);
  const review = `<div class="viewing-list"><div class="listitem"><article class="production-viewing">
    <div data-item-slug="sample" data-item-name="Sample (2020)"></div>
    <span class="inline-rating"><svg aria-label="\u2605\u2605\u2605\u00bd"></svg></span>
    <svg class="inline-liked"></svg></article></div></div>`;
  const [item] = parser.parseCatalog(review, pageUrl, 'reviewed', 'member').items;
  assert.equal(item.rating, 3.5);
  assert.equal(item.liked, true);
  assert.equal(item.reviewed, true);
});

function catalogWithDiaryPreview(rows = filmRow(), next = '') {
  return `<html><head><title>Member films</title></head><body>
    <div class="modal" id="diary-entry-modal">
      <figure class="poster-list -p150 no-hover js-poster-preview"></figure>
      <p class="empty">No preview</p>
      <a class="next" href="/unrelated/page/2/">Next preview</a>
    </div>
    <main id="content">
      <div role="dialog"><ul class="poster-list"></ul><p class="empty">No preview</p></div>
      <figure class="poster-list js-poster-preview"></figure>
      <div class="poster-grid"><ul class="grid -p70">${rows}</ul></div>
      ${next ? `<div class="pagination"><a class="next" href="${next}">Older</a></div>` : ''}
    </main>
    <aside><ul class="poster-list">${filmRow('unrelated')}</ul></aside>
  </body></html>`;
}

test('catalogue ignores the diary poster preview before the real main content and uses its pagination', () => {
  const { parser } = harness();
  const result = parser.parseCatalog(
    catalogWithDiaryPreview(filmRow('sample', '<span class="rating rated-5"></span>'), '/tester/films/page/2/'),
    pageUrl, 'watched', 'member');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'sample');
  assert.equal(result.items[0].rating, 2.5);
  assert.equal(result.nextUrl, pageUrl + 'page/2/');
  const lastPage = parser.parseCatalog(catalogWithDiaryPreview(), pageUrl, 'watched', 'member');
  assert.equal(lastPage.nextUrl, null);
});

test('preview empty messages cannot hide a broken or missing real catalogue', () => {
  const { parser } = harness();
  assert.throws(() => parser.parseCatalog(catalogWithDiaryPreview(''), pageUrl, 'watched', 'member'), /HTML modifié/);
  assert.throws(() => parser.parseCatalog(catalogWithDiaryPreview('<li class="griditem">Broken</li>'),
    pageUrl, 'watched', 'member'), /non reconnu/);
  const previewOnly = '<div class="modal"><figure class="poster-list js-poster-preview"></figure><p class="empty">Empty preview</p></div>';
  assert.throws(() => parser.parseCatalog(previewOnly, pageUrl, 'watched', 'member'), /non reconnu/);
  const empty = catalogWithDiaryPreview('').replace('<ul class="grid -p70"></ul>',
    '<p class="empty-message">No films</p>');
  assert.equal(parser.parseCatalog(empty, pageUrl, 'watched', 'member').items.length, 0);
});

test('legacy catalogue fragments still ignore modal previews when no main wrapper exists', () => {
  const { parser } = harness();
  const fragment = `<div class="modal"><figure class="poster-list js-poster-preview"></figure></div>
    <ul class="poster-list"><li class="poster-container"><div data-film-slug="sample" data-film-name="Sample"></div></li></ul>`;
  assert.equal(parser.parseCatalog(fragment, pageUrl, 'watched', 'member').items[0].id, 'sample');
});

test('reload traverses real catalogue pages past diary previews and keeps old cache on a broken next page', async () => {
  let broken = false;
  const h = actionsHarness({
    tm_letterboxd_profiles: { [profile.id]: profile }
  }, async (_, { url }) => ({
    html: url.endsWith('page/2/')
      ? catalogWithDiaryPreview(broken ? '' : filmRow('second'))
      : catalogWithDiaryPreview(filmRow(), '/tester/films/page/2/')
  }));
  await h.ui.handleReload({}, profile.id, profile.title);
  assert.equal(h.errors.length, 0);
  assert.deepEqual(h.data.tm_letterboxd_catalogs[profile.id].items.map((item) => item.id), ['sample', 'second']);
  const previous = structuredClone(h.data.tm_letterboxd_catalogs[profile.id]);
  broken = true;
  await h.ui.handleReload({}, profile.id, profile.title);
  assert.match(h.errors.at(-1).message, /page 2.*HTML modifié/);
  assert.deepEqual(h.data.tm_letterboxd_catalogs[profile.id], previous);
});

test('challenge, login, unknown markup and partially unrecognized catalogues are explicit failures', () => {
  const { parser } = harness();
  for (const html of [
    '<html><head><title>Just a moment...</title></head></html>',
    '<html><head><title>Sign in • Letterboxd</title></head></html>',
    '<div id="challenge-form"></div>', '<p>Changed HTML</p>', catalog(''),
    catalog(filmRow() + '<li class="griditem">Broken item</li>')
  ]) assert.throws(() => parser.parseCatalog(html, pageUrl, 'watched', 'member'));
  assert.equal(parser.parseCatalog('<p class="empty">No films</p>', pageUrl, 'watched', 'member').items.length, 0);
  assert.equal(parser.parseCatalog(catalog() + '<form action="/sign-in/"><input name="password"></form>', pageUrl, 'watched', 'member').items.length, 1);
});

test('film JSON-LD provides the vertical poster, exact runtime and film metadata, never the backdrop', () => {
  const { parser } = harness();
  const film = parser.parseFilm(filmDetails({}, '<meta property="og:image" content="https://a.ltrbxd.com/backdrop.jpg">'), 'sample');
  assert.equal(film.posterUrl, posterUrl);
  assert.equal(film.duration, 90);
  assert.equal(film.year, 2020);
  assert.equal(film.averageRating, 4);
  assert.deepEqual(plain(film.countries), ['France']);
  assert.deepEqual(plain(film.languages), ['French', 'fr']);
  assert.deepEqual(plain(film.directors), ['Alex Test']);
  assert.equal(parser.parseFilm(filmDetails({ datePublished: undefined, dateCreated: '2019-05-01' }), 'sample').year, 2019);
  assert.throws(() => parser.parseFilm('<title>No data</title>', 'sample'), /absentes/);
  assert.throws(() => parser.parseFilm('<script type="application/ld+json">{broken}</script>', 'sample'));
  assert.throws(() => parser.parseFilm(filmDetails(), 'another-film'), /ne correspond pas/);
});

test('poster resolution is upgraded without changing the film, version, other hosts or larger originals', async () => {
  const small = 'https://a.ltrbxd.com/resized/film-poster/1/7/9/5/5/1/179551-hope-0-600-0-900-crop.jpg?v=b04f20b036';
  const large = small.replace('-600-0-900-', '-1000-0-1500-');
  const { parser, client, calls } = harness(async () => ({ dataUrl: 'data:image/jpeg;base64,AA==' }));
  assert.equal(parser.parseFilm(filmDetails({ image: small }), 'sample').posterUrl, large);
  assert.equal(parser.highResolutionPoster(large), large);
  const larger = small.replace('-600-0-900-', '-2000-0-3000-');
  assert.equal(parser.highResolutionPoster(larger), larger);
  for (const unchanged of [posterUrl, small.replace('a.ltrbxd.com', 'example.com'),
    small.replace('/film-poster/', '/avatar/')]) {
    assert.equal(parser.highResolutionPoster(unchanged), unchanged);
  }
  await client.fetchPoster({ posterUrl: small, detailsLoaded: true, name: 'Hope' });
  assert.equal(calls[0].payload.url, large);
});

test('traverses every page, deduplicates films and uses the requested account collection or filmography', async () => {
  const { client, calls } = harness(async (_, { url }) => ({
    html: url.endsWith('page/2/') ? catalog(filmRow() + filmRow('other'))
      : catalog(filmRow(), url + 'page/2/')
  }));
  const catalogResult = await client.reloadCatalog(profile, { collection: 'watched' });
  assert.equal(catalogResult.items.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(catalogResult.totalItems, 2);
  assert.equal(client.catalogUrl(profile, 'liked'), profile.canonicalUrl + 'likes/films/');
  assert.equal(client.catalogUrl(profile, 'reviewed'), profile.canonicalUrl + 'reviews/films/');
  assert.equal(client.catalogUrl(profile, 'watchlist'), profile.canonicalUrl + 'watchlist/');
  assert.equal(client.catalogUrl(director, 'watched'), director.canonicalUrl);
  assert.throws(() => client.catalogUrl({ ...profile, id: 'member:someone-else' }, 'watched'), /incohérente/);
});

test('repeated pagination, cross-catalogue and external links never produce a partial successful catalogue', async () => {
  for (const next of [
    pageUrl, 'https://example.com/tester/films/page/2/',
    profile.canonicalUrl + 'likes/films/page/2/', pageUrl + 'page/2/?query=x'
  ]) {
    const { client } = harness(async () => ({ html: catalog(filmRow(), next) }));
    await assert.rejects(client.reloadCatalog(profile, {}), /pagination|Pagination/);
  }
  const { client } = harness(async (_, { url }) => {
    if (url.endsWith('page/2/')) throw new Error('HTTP 429');
    return { html: catalog(filmRow(), pageUrl + 'page/2/') };
  });
  await assert.rejects(client.reloadCatalog(profile, {}), /page 2 \(1 film\(s\) lus\).*429/);
});

test('details are fetched lazily once per film and missing posters fail explicitly', async () => {
  const { client, calls } = harness(async (type) => type === 'LETTERBOXD_IMAGE'
    ? { dataUrl: 'data:image/jpeg;base64,AA==' } : { html: filmDetails() });
  const items = [{ id: 'sample', slug: 'sample', name: 'Sample', rating: 2 }];
  const prepared = await client.prepareItems(items);
  assert.equal(prepared[0].rating, 2);
  assert.equal(calls.length, 1);
  await client.prepareItems(prepared);
  assert.equal(calls.length, 1);
  assert.match(await client.fetchPoster(prepared[0]), /^data:image/);
  assert.equal(calls.at(-1).payload.url, posterUrl);
  const broken = harness(async () => ({ html: filmDetails({ image: '' }) }));
  await assert.rejects(broken.client.fetchPoster(items[0]), /Aucune affiche/);
});

const detailedItem = {
  id: 'sample', slug: 'sample', name: 'Sample Éclair', year: 2020, rating: 3.5, liked: true,
  duration: 90, averageRating: 4, genres: ['Drama', 'Comedy'], directors: ['Alex Test'],
  actors: ['Chris Example'], countries: ['France'], languages: ['French'], detailsLoaded: true
};
test('all numeric bounds are inclusive and combined text filters support alternatives without accents', () => {
  const { filters } = harness();
  const selected = filters.filterItems([detailedItem], {
    ratingMin: '3.5', ratingMax: '3.5', yearMin: '2020', yearMax: '2020',
    durationMin: '90', durationMax: '90', averageMin: '4', averageMax: '4',
    title: 'eclair', genres: 'Thriller,Drama', countries: 'France', languages: 'French',
    director: 'alex', actor: 'chris', rated: 'yes', liked: 'yes'
  });
  assert.equal(selected.length, 1);
  for (const [key, value] of [
    ['ratingMin', '4'], ['ratingMax', '3'], ['yearMin', '2021'], ['yearMax', '2019'],
    ['durationMin', '91'], ['durationMax', '89'], ['averageMin', '4.01'], ['averageMax', '3.99'],
    ['title', 'other'], ['genres', 'Horror'], ['countries', 'USA'], ['languages', 'English'],
    ['director', 'Other'], ['actor', 'Someone'], ['rated', 'no'], ['liked', 'no']
  ]) assert.equal(filters.filterItems([detailedItem], { [key]: value }).length, 0, key);
});

test('rated and unrated selections, sorting, descending and explicit limits preserve original catalogue', () => {
  const { filters } = harness();
  const items = [detailedItem, { ...detailedItem, id: 'other', name: 'AAA', year: 2000, rating: null }];
  assert.equal(filters.filterItems(items, { collection: 'rated' }).length, 1);
  assert.equal(filters.filterItems(items, { rated: 'no' })[0].id, 'other');
  assert.equal(filters.filterItems(items, { sort: 'title', limit: '1' })[0].id, 'other');
  assert.equal(filters.filterItems(items, { sort: 'year', descending: true })[0].id, 'sample');
  assert.equal(filters.filterItems(items, { sort: 'catalog', descending: true })[0].id, 'other');
  assert.equal(items[0].id, 'sample');
  const many = Array.from({ length: 501 }, (_, id) => ({ ...detailedItem, id }));
  assert.equal(filters.filterItems(many, {}).length, 501);
  assert.equal(filters.filterItems(many, { limit: '500' }).length, 500);
});

test('invalid ranges, missing metadata and incompatible personal filters are not silently ignored', () => {
  const { filters } = harness();
  for (const values of [
    { ratingMin: '3.2' }, { yearMin: 'NaN' }, { yearMin: '2021', yearMax: '2020' },
    { limit: '0' }, { limit: '1.5' }, { averageMax: '6' }, { sort: 'invalid' },
    { collection: 'rated', rated: 'no' }, { collection: 'liked', liked: 'no' },
    { collection: 'watchlist', ratingMin: '1' }
  ]) assert.throws(() => filters.filterItems([detailedItem], values));
  assert.throws(() => filters.validate({ liked: 'yes' }, 'director'), /filmographie/);
  assert.throws(() => filters.filterItems([{ ...detailedItem, duration: null }], { durationMin: '1' }), /indisponible/);
  assert.throws(() => filters.filterItems([{ ...detailedItem, countries: [] }], { countries: 'France' }), /indisponible/);
  assert.equal(filters.filterItems([{ ...detailedItem, rating: null }], { ratingMin: '1' }).length, 0);
  assert.throws(() => filters.filterItems([{ ...detailedItem, ratingKnown: false }], { ratingMin: '1' }), /inconnue/);
  assert.throws(() => filters.filterItems([{ ...detailedItem, liked: null }], { liked: 'yes' }), /inconnu/);
});

test('saved accounts and directors keep independent catalogues, merge profiles, delete cleanly and preserve Steam', async () => {
  const { storage, data, sandbox } = harness(undefined, { tm_users: { steam: { personaname: 'Steam' } } });
  await storage.saveLetterboxdProfile(profile.id, profile);
  await storage.saveLetterboxdProfile(director.id, director);
  await storage.saveLetterboxdProfile(profile.id, { title: 'New title' });
  await storage.saveLetterboxdCatalog(profile.id, { collection: 'liked', items: [detailedItem] });
  await storage.saveLetterboxdCatalog(director.id, { collection: 'filmography', items: [] });
  await storage.saveSettings({ letterboxdFilters: { yearMin: '2000' } });
  assert.equal((await storage.getLetterboxdProfiles())[profile.id].title, 'New title');
  assert.equal((await storage.getLetterboxdCatalog(profile.id)).items.length, 1);
  await storage.removeLetterboxdProfile(profile.id);
  assert.equal(await storage.getLetterboxdCatalog(profile.id), null);
  assert.ok((await storage.getLetterboxdProfiles())[director.id]);
  assert.equal(data.tm_users.steam.personaname, 'Steam');
  sandbox.chrome.runtime.lastError = { message: 'Storage failure' };
  await assert.rejects(storage.saveSettings({ letterboxdKind: 'director' }), /Storage failure/);
  delete sandbox.chrome.runtime.lastError;
  sandbox.chrome.storage.local.set = (_, callback) => {
    sandbox.chrome.runtime.lastError = { message: 'Quota exceeded' };
    callback();
    delete sandbox.chrome.runtime.lastError;
  };
  await assert.rejects(storage.saveLetterboxdProfile(profile.id, profile), /Quota exceeded/);
  assert.equal((await storage.getLetterboxdProfiles())[profile.id], undefined);
});

function backgroundHarness(fetch) {
  const sandbox = vm.createContext({ URL, AbortSignal, Uint8Array, btoa, fetch });
  load(sandbox, 'letterboxd/background/letterboxd-background.js');
  return sandbox.TMLetterboxdBackground;
}
test('worker validates page/image origins, omits cookies, blocks redirects and validates real image content', async () => {
  const background = backgroundHarness(async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return url.includes('ltrbxd') ? new Response(new Uint8Array([0, 1]), { headers: { 'Content-Type': 'image/jpeg' } })
      : new Response(catalog());
  });
  assert.match((await background.handlers.LETTERBOXD_PAGE({ url: pageUrl })).html, /poster-grid/);
  assert.match((await background.handlers.LETTERBOXD_IMAGE({ url: posterUrl })).dataUrl, /^data:image\/jpeg;base64/);
  for (const url of ['https://evil.com/a/', 'http://letterboxd.com/a/', 'https://letterboxd.com/a/?x=1',
    'https://u:p@letterboxd.com/a/', 'https://letterboxd.com:99/a/']) {
    assert.throws(() => background.assertPageUrl(url));
  }
  for (const url of ['https://evil.com/a.jpg', 'http://a.ltrbxd.com/a.jpg', 'https://s.ltrbxd.com/empty-poster.png']) {
    assert.throws(() => background.assertImageUrl(url));
  }
  await assert.rejects(background.handlers.LETTERBOXD_PAGE({ url: 'https://evil.com/a/' }), /non autorisee/);
  const notImage = backgroundHarness(async () => new Response('<html>Blocked</html>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(notImage.handlers.LETTERBOXD_IMAGE({ url: posterUrl }), /image valide/);
});

test('worker exposes HTTP limits and anti-bot responses without retries or success-shaped fallbacks', async () => {
  for (const status of [403, 404, 429, 500]) {
    let requests = 0;
    const background = backgroundHarness(async () => { requests++; return new Response('', { status }); });
    await assert.rejects(background.handlers.LETTERBOXD_PAGE({ url: pageUrl }), new RegExp(`HTTP ${status}`));
    assert.equal(requests, 1);
  }
  const background = backgroundHarness(async () => new Response('<title>Just a moment...</title>'));
  await assert.rejects(background.handlers.LETTERBOXD_PAGE({ url: pageUrl }), /anti-robot/);
});

function actionsHarness(initial, respond) {
  const h = harness(respond, initial);
  const dom = parseHTML('<html><body></body></html>');
  h.sandbox.document = dom.document;
  h.sandbox.MutationObserver = dom.MutationObserver;
  load(h.sandbox, 'content/state/content-state.js');
  const ui = h.sandbox.TMContent;
  const errors = [];
  const messages = [];
  Object.assign(ui, {
    showMessage: (_, message, isError) => messages.push({ message, isError }),
    logError: (_, context, message, extra = {}) => { errors.push({ context, message, ...extra }); ui.state.logs.push({ context, message, ...extra }); },
    showFailedGames() {}, setButtonsBusy() {}, setProgress() {}, updateLogsButton() {}, renderUsersList: async () => {}
  });
  ui.state.currentSource = 'letterboxd';
  ui.state.letterboxdFilters = { ...h.filters.DEFAULTS };
  load(h.sandbox, 'letterboxd/content/letterboxd-actions.js');
  load(h.sandbox, 'letterboxd/content/letterboxd-posters.js');
  load(h.sandbox, 'content/reload/content-reload.js');
  load(h.sandbox, 'content/import/content-import.js');
  return { ...h, ui, errors, messages };
}

test('failed reload keeps previous cache and offers a Letterboxd-specific retry; success removes its errors', async () => {
  let fail = true;
  const h = actionsHarness({
    tm_letterboxd_profiles: { [profile.id]: profile },
    tm_letterboxd_catalogs: { [profile.id]: { items: [detailedItem], collection: 'watched' } }
  }, async () => {
    if (fail) throw new Error('HTTP 429');
    return { html: catalog() };
  });
  const before = structuredClone(h.data.tm_letterboxd_catalogs);
  await h.ui.handleReload({}, profile.id, profile.title);
  assert.deepEqual(h.data.tm_letterboxd_catalogs, before);
  assert.equal(h.errors[0].retryReload.source, 'letterboxd');
  fail = false;
  await h.ui.handleReload({}, profile.id, profile.title);
  assert.equal(h.ui.state.logs.length, 0);
  assert.equal(h.data.tm_letterboxd_catalogs[profile.id].items[0].rating, null);
  assert.equal(h.data.tm_letterboxd_catalogs[profile.id].items[0].detailsLoaded, undefined);
});

test('import blocks stale collections and incompatible personal filters on director filmographies', async () => {
  const h = actionsHarness({
    tm_letterboxd_profiles: { [profile.id]: profile, [director.id]: director },
    tm_letterboxd_catalogs: { [profile.id]: { items: [detailedItem], collection: 'watched' } }
  });
  h.ui.state.letterboxdFilters.collection = 'liked';
  await h.ui.handleImport({}, {}, profile.id, profile.title);
  assert.match(h.errors.at(-1).message, /Rechargez/);
  h.ui.state.letterboxdFilters.ratingMin = '3';
  await h.ui.handleImport({}, {}, director.id, director.title);
  assert.match(h.errors.at(-1).message, /filmographie/);
});

test('Letterboxd posters use the shared TierMaker import and source-specific image cache', async () => {
  let imageRequests = 0;
  const h = actionsHarness({
    'tm_img:letterboxd:sample:poster': 'data:image/jpeg;base64,OLD=',
    tm_letterboxd_profiles: { [profile.id]: profile },
    tm_letterboxd_catalogs: { [profile.id]: { items: [{ ...detailedItem, posterUrl }], collection: 'watched' } }
  }, async (type) => {
    assert.equal(type, 'LETTERBOXD_IMAGE');
    imageRequests++;
    return { dataUrl: 'data:image/jpeg;base64,AA==' };
  });
  h.sandbox.fetch = async () => ({ blob: async () => ({ type: 'image/jpeg' }) });
  h.sandbox.File = class { constructor(parts, name) { this.name = name; } };
  h.sandbox.Event = class { constructor(type) { this.type = type; } };
  h.sandbox.DataTransfer = class {
    constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; }
  };
  const changes = [];
  const input = { dispatchEvent: (event) => changes.push(event.type) };
  for (let i = 0; i < 2; i++) {
    await h.ui.handleImport({}, input, profile.id, profile.title);
    assert.equal(h.errors.length, 0);
    assert.equal(input.files.length, 1);
    assert.match(input.files[0].name, /_poster\.jpg$/);
  }
  assert.equal(imageRequests, 1);
  assert.equal(h.data['tm_img:letterboxd:sample:poster-hd'], 'data:image/jpeg;base64,AA==');
  assert.deepEqual(changes, ['change', 'change']);
});

test('only registered Letterboxd tiles are enlarged, including asynchronous imports and moves to ranks', async () => {
  const { document, MutationObserver } = parseHTML('<html><body><div id="reserve"></div><div id="rank"></div></body></html>');
  const sandbox = vm.createContext({ document, MutationObserver, TMContent: {} });
  load(sandbox, 'letterboxd/content/letterboxd-posters.js');
  sandbox.TMContent.registerLetterboxdPoster('data:image/jpeg;base64,POSTER');
  const reserve = document.querySelector('#reserve');
  reserve.innerHTML = `<div class="character extra-images"><img class="draggable-filler" src="data:image/jpeg;base64,POSTER"></div>
    <div class="character extra-images"><img class="draggable-filler" src="data:image/jpeg;base64,OTHER"></div>
    <div class="character"><img class="draggable-filler" src="data:image/jpeg;base64,POSTER"></div>`;
  await new Promise(setImmediate);
  assert.equal(reserve.querySelectorAll('.tm-letterboxd-poster').length, 1);
  const poster = reserve.querySelector('.tm-letterboxd-poster');
  document.querySelector('#rank').append(poster);
  await new Promise(setImmediate);
  assert.ok(poster.classList.contains('tm-letterboxd-poster'));
});

test('all failed posters remain individually retryable without replacing existing TierMaker files', async () => {
  const h = actionsHarness({
    tm_letterboxd_profiles: { [profile.id]: profile },
    tm_letterboxd_catalogs: { [profile.id]: { items: [{ ...detailedItem, posterUrl }], collection: 'watched' } }
  }, async () => { throw new Error('HTTP 403'); });
  h.sandbox.console = { warn() {} };
  h.sandbox.DataTransfer = class { constructor() { this.items = { add() {} }; } };
  const input = { files: ['existing'] };
  await h.ui.handleImport({}, input, profile.id, profile.title);
  assert.deepEqual(input.files, ['existing']);
  assert.equal(h.ui.state.failedImports.length, 1);
  assert.equal(h.errors[0].retryGame.source, 'letterboxd');
  assert.equal(h.errors[0].retryGame.imageType, 'poster');
});

test('filter controls render every setting safely, serialize rapid changes and surface storage failures', async () => {
  const { sandbox, data, filters } = harness();
  load(sandbox, 'content/state/content-state.js');
  const ui = sandbox.TMContent;
  ui.escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  ui.state.letterboxdFilters = { ...filters.DEFAULTS, title: '"><script>bad</script>' };
  load(sandbox, 'letterboxd/content/letterboxd-controls.js');
  const template = ui.renderLetterboxdControls();
  const doc = new DOMParser().parseFromString(`<html><body>${template.controlsHtml}${template.searchPanelHtml}</body></html>`, 'text/html');
  assert.equal(doc.querySelectorAll('[data-lb-filter]').length, Object.keys(filters.DEFAULTS).length);
  assert.deepEqual([...doc.querySelectorAll('.tm-letterboxd-section legend')].map((node) => node.textContent),
    ['Compte', 'Films', 'Détails', 'Import']);
  assert.equal(doc.querySelectorAll('p').length, 0);
  for (const input of doc.querySelectorAll('input[id], select[id]')) {
    assert.ok(doc.querySelector(`label[for="${input.id}"]`), input.id);
  }
  assert.equal(doc.querySelectorAll('script').length, 0);
  assert.equal(doc.querySelector('#tm-letterboxd-title').getAttribute('value'), '"><script>bad</script>');
  const listeners = {};
  const overlay = { addEventListener: (type, callback) => listeners[type] = callback };
  const errors = [];
  ui.showMessage = (_, message) => errors.push(message);
  ui.logError = () => {};
  ui.bindLetterboxdEvents(overlay);
  const first = listeners.change({ target: { dataset: { lbFilter: 'yearMin' }, value: '2000' } });
  const second = listeners.change({ target: { dataset: { lbFilter: 'yearMax' }, value: '2020' } });
  await Promise.all([first, second]);
  assert.equal(data.tm_settings.letterboxdFilters.yearMin, '2000');
  assert.equal(data.tm_settings.letterboxdFilters.yearMax, '2020');
  sandbox.chrome.runtime.lastError = { message: 'Storage failure' };
  const target = { dataset: { lbFilter: 'yearMin' }, value: '2001' };
  await listeners.change({ target });
  assert.equal(target.value, '2000');
  assert.deepEqual(errors, ['Storage failure']);
});

test('modal restores persisted Letterboxd filters and accounts render as a separate source', async () => {
  const h = harness(undefined, {
    tm_settings: { currentSource: 'letterboxd', letterboxdKind: 'director', letterboxdFilters: { yearMin: '1990' } },
    tm_letterboxd_profiles: { [director.id]: director },
    tm_letterboxd_catalogs: { [director.id]: { items: [detailedItem], collection: 'filmography' } }
  });
  const { document } = parseHTML('<html><body></body></html>');
  h.sandbox.document = document;
  load(h.sandbox, 'content/state/content-state.js');
  const ui = h.sandbox.TMContent;
  ui.escapeHtml = (value) => String(value);
  ui.renderIcon = () => '';
  ui.getExtensionIconUrl = () => '';
  ui.renderSourceLogo = () => '';
  ui.bindModalEvents = () => {};
  load(h.sandbox, 'letterboxd/content/letterboxd-controls.js');
  load(h.sandbox, 'content/modal/content-modal-template.js');
  load(h.sandbox, 'content/users/content-users-list.js');
  load(h.sandbox, 'content/modal/content-modal-lifecycle.js');
  await ui.openModal({});
  assert.equal(ui.state.currentSource, 'letterboxd');
  assert.equal(ui.state.letterboxdFilters.yearMin, '1990');
  assert.equal(ui.state.letterboxdFilters.yearMax, '');
  assert.equal(document.querySelector('#tm-letterboxd-kind option[selected]').value, 'director');
  assert.match(document.querySelector('#tm-users-list').textContent, /Réalisateur.*1 film\(s\).*Filmographie/);
  assert.equal(document.querySelector('.tm-user-row').dataset.profileId, director.id);
});

test('rated catalogues contain only rated films and empty catalogues can be saved successfully', async () => {
  const h = harness(async () => ({ html: catalog(filmRow('rated', '<span class="rating rated-1"></span>') + filmRow('unrated')) }));
  const rated = await h.client.reloadCatalog(profile, { collection: 'rated' });
  assert.equal(rated.totalItems, 1);
  assert.equal(rated.items[0].id, 'rated');
  const empty = harness(async () => ({ html: '<p class="empty-message">No films</p>' }));
  assert.equal((await empty.client.reloadCatalog(profile, {})).totalItems, 0);
});

test('metadata filtering enriches and saves film details once, then imports only matching films', async () => {
  const h = actionsHarness({
    tm_letterboxd_profiles: { [profile.id]: profile },
    tm_letterboxd_catalogs: { [profile.id]: { items: [{ id: 'sample', slug: 'sample', name: 'Sample' }], collection: 'watched' } }
  }, async () => ({ html: filmDetails() }));
  h.ui.state.letterboxdFilters.durationMin = '90';
  h.ui.state.letterboxdFilters.director = 'alex';
  const imports = [];
  h.ui.importItemsAsImages = async (input, items, type, progress, append, source) => {
    imports.push({ items: plain(items), type, source });
    return { imported: items.length, failedItems: [] };
  };
  await h.ui.handleImport({}, {}, profile.id, profile.title);
  assert.equal(h.errors.length, 0);
  assert.equal(h.data.tm_letterboxd_catalogs[profile.id].items[0].detailsLoaded, true);
  assert.equal(imports[0].items[0].duration, 90);
  assert.equal(imports[0].type, 'poster');
  assert.equal(imports[0].source, 'letterboxd');
  await h.ui.handleImport({}, {}, profile.id, profile.title);
  assert.equal(h.calls.length, 1);
});

test('director filmographies load independently of account collections and support normal film filters', async () => {
  const h = actionsHarness({ tm_letterboxd_profiles: { [director.id]: director } }, async () => ({ html: catalog() }));
  h.ui.state.letterboxdFilters.collection = 'liked';
  h.ui.state.letterboxdFilters.yearMin = '2010';
  await h.ui.handleReload({}, director.id, director.title);
  assert.equal(h.data.tm_letterboxd_catalogs[director.id].collection, 'filmography');
  assert.equal(h.calls[0].payload.url, director.canonicalUrl);
  let imported = 0;
  h.ui.importItemsAsImages = async (input, items) => { imported += items.length; return { imported, failedItems: [] }; };
  await h.ui.handleImport({}, {}, director.id, director.title);
  assert.equal(imported, 1);
  assert.equal(h.errors.length, 0);
});

test('adding a Letterboxd source saves the verified account and cannot fall through to Steam', async () => {
  const h = actionsHarness({}, async () => ({
    html: '<html><head><title>Member</title></head><body><h1 class="profile-name">Saved Member</h1></body></html>'
  }));
  const elements = { '#tm-search-input': { value: 'tester' }, '#tm-add-user-panel': { style: {} } };
  const overlay = { querySelector: (selector) => elements[selector] };
  Object.assign(h.ui, {
    hideSearchResults() {}, debounce: (fn) => fn, escapeHtml: (value) => value
  });
  load(h.sandbox, 'content/search/content-search.js');
  await h.ui.addUserAndRefreshList(overlay, 'tester', 'letterboxd');
  assert.equal(h.data.tm_letterboxd_profiles[profile.id].title, 'Saved Member');
  assert.equal(elements['#tm-search-input'].value, '');
  assert.equal(elements['#tm-add-user-panel'].style.display, 'none');
  assert.equal(h.errors.length, 0);
});

test('Letterboxd search invalidates stale responses on newer queries and source changes', async () => {
  const h = harness();
  load(h.sandbox, 'content/state/content-state.js');
  const ui = h.sandbox.TMContent;
  ui.state.currentSource = 'letterboxd';
  let scheduled;
  const rows = [];
  const container = { style: {}, appendChild: (row) => rows.push(row), innerHTML: '' };
  const overlay = { isConnected: true, querySelector: () => container };
  let finish;
  h.sandbox.TMLetterboxdClient.resolveInput = () => new Promise((resolve) => { finish = resolve; });
  h.sandbox.document = { createElement: () => ({ addEventListener() {} }) };
  ui.debounce = (fn) => (...args) => { scheduled = () => fn(...args); };
  ui.escapeHtml = (value) => value;
  ui.hideSearchResults = () => { rows.length = 0; };
  ui.showMessage = () => {};
  ui.logError = () => assert.fail('A stale response should not produce errors');
  load(h.sandbox, 'content/search/content-search.js');
  ui.performSearch(overlay, 'tester');
  const first = scheduled();
  ui.state.currentSource = 'steam';
  finish(profile);
  await first;
  assert.equal(rows.length, 0);
});

test('poster retry identity remains Letterboxd-specific even after switching source', () => {
  const h = harness();
  load(h.sandbox, 'content/state/content-state.js');
  load(h.sandbox, 'content/logs/content-logs.js');
  h.sandbox.TMContent.state.currentSource = 'steam';
  const key = h.sandbox.TMContent.getFailedImportKey({ id: 'sample', source: 'letterboxd', imageType: 'poster' });
  assert.equal(key, 'letterboxd:sample:poster');
});

test('client message bridge reports missing responses, runtime failures and malformed image replies', async () => {
  const h = harness(async () => undefined);
  await assert.rejects(h.client.resolveInput('tester'), /ne répond pas/);
  h.sandbox.chrome.runtime.lastError = { message: 'Context invalidated' };
  await assert.rejects(h.client.resolveInput('tester'), /Context invalidated/);
  delete h.sandbox.chrome.runtime.lastError;
  h.sandbox.chrome.runtime.sendMessage = (_, callback) => callback({});
  await assert.rejects(h.client.resolveInput('tester'), /Réponse Letterboxd invalide/);
  await assert.rejects(h.client.fetchPoster({ posterUrl, name: 'Sample' }), /affiche Letterboxd invalide/);
});

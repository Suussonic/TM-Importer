const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const channelId = 'UC' + 'a'.repeat(22);
const videoId = 'abcdefghijk';
const otherId = 'lmnopqrstuv';
const context = { client: { clientName: 'WEB', clientVersion: 'test-version' } };
const continuation = (token) => ({
  continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } }
});
const video = (id = videoId) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: 'A } "quoted" title' }] } } });
const lockup = (id = videoId) => ({
  lockupViewModel: {
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: id,
    metadata: { lockupMetadataViewModel: { title: { content: 'A video' } } }
  }
});
function page(contents, extra = {}) {
  return {
    contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { contents } } }] } },
    ...extra
  };
}
function html(data, player) {
  return `<script>var ytInitialData = ${JSON.stringify(data)};</script>
    <script>ytcfg.set({"INNERTUBE_CONTEXT":${JSON.stringify(context)}});</script>
    ${player ? `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>` : ''}`;
}
function loadScraper(fetch, extras = {}) {
  const sandbox = vm.createContext({ URL, AbortSignal, fetch, ...extras });
  vm.runInContext(readFileSync(path.join(root, 'youtube', 'background', 'youtube-background-scrape.js'), 'utf8'), sandbox);
  return sandbox.TMYouTubeScrape;
}
function loadClient(request) {
  const sandbox = vm.createContext({ TMYouTubeNetwork: { request } });
  vm.runInContext(readFileSync(path.join(root, 'youtube', 'client', 'youtube-client.js'), 'utf8'), sandbox);
  return sandbox.TMYouTubeClient;
}
const catalogRequest = { url: 'https://www.youtube.com/@test/videos', itemType: 'video' };

test('manifest loads existing scripts without Google API permissions', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const script of manifest.content_scripts.flatMap((entry) => entry.js)) {
    assert.ok(existsSync(path.join(root, script)), script);
  }
  assert.ok(manifest.host_permissions.includes('https://www.youtube.com/*'));
  assert.ok(!manifest.host_permissions.some((host) => /googleapis|accounts\.google/.test(host)));
  const sandbox = vm.createContext({ TMContent: {} });
  vm.runInContext(readFileSync(path.join(root, 'content', 'modal', 'content-modal-template-youtube.js'), 'utf8'), sandbox);
  const controls = sandbox.TMContent.renderYouTubeControls();
  assert.doesNotMatch(controls.controlsHtml + controls.searchPanelHtml, /disabled/);
  assert.doesNotMatch(controls.controlsHtml, /<p\b/);
  for (const id of ['tm-youtube-from-date', 'tm-youtube-to-date', 'tm-youtube-include-long', 'tm-youtube-include-shorts']) {
    assert.equal(controls.controlsHtml.split(`id="${id}"`).length - 1, 1);
  }
  assert.match(controls.controlsHtml, /<legend>Format<\/legend>/);
  assert.match(controls.searchPanelHtml, /aria-controls="tm-search-results"/);
  assert.doesNotMatch(controls.searchPanelHtml, /<kbd|tm-youtube-url-input/);
});

test('extracts legacy and modern videos, deduplicating IDs and parsing quoted braces', async () => {
  const scraper = loadScraper(async () => new Response(html(page([
    video(), lockup(), lockup(otherId), continuation('next')
  ]))));
  const result = await scraper.loadCatalogPage(catalogRequest);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].videoId, videoId);
  assert.equal(result.continuation, 'next');
  assert.equal(result.context.client.clientVersion, 'test-version');
});

test('Shorts are classified from their renderer, not duration', async () => {
  const scraper = loadScraper(async () => new Response(html(page([{
    shortsLockupViewModel: {
      onTap: { innertubeCommand: { reelWatchEndpoint: { videoId } } },
      overlayMetadata: { primaryText: { content: 'A Short' } }
    }
  }]))));
  const result = await scraper.loadCatalogPage({ ...catalogRequest, itemType: 'short' });
  assert.equal(result.items[0].itemType, 'short');
});

test('pagination uses public web continuation, no API key or authorization', async () => {
  const scraper = loadScraper(async (url, options) => {
    assert.equal(url, 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers['X-Youtube-Client-Name'], '1');
    assert.equal(options.headers['X-Youtube-Client-Version'], 'test-version');
    assert.ok(!options.headers.Authorization);
    const body = JSON.parse(options.body);
    assert.equal(body.continuation, 'next');
    assert.equal(body.context.client.clientVersion, 'test-version');
    return Response.json({ onResponseReceivedActions: [{
      appendContinuationItemsAction: { continuationItems: [lockup(otherId), {
        continuationItemViewModel: { continuationCommand: { innertubeCommand: { continuationCommand: { token: 'last' } } } }
      }] }
    }] });
  });
  const result = await scraper.loadCatalogPage({ continuation: 'next', context, itemType: 'video' });
  assert.equal(result.items[0].videoId, otherId);
  assert.equal(result.continuation, 'last');
});

test('recognizes terminal playlist context but rejects unknown response shapes', async () => {
  const request = { continuation: 'next', context, itemType: 'unknown' };
  const terminal = loadScraper(async () => Response.json({ responseContext: {}, trackingParams: 'ok' }));
  assert.equal((await terminal.loadCatalogPage(request)).items.length, 0);
  const broken = loadScraper(async () => Response.json({}));
  await assert.rejects(broken.loadCatalogPage(request), /pagination YouTube non reconnue/);
});

test('HTTP errors, changed markup, redirects and private playlists are explicit', async () => {
  const limited = loadScraper(async () => new Response('', { status: 429 }));
  await assert.rejects(limited.loadCatalogPage(catalogRequest), /HTTP 429/);
  const missing = loadScraper(async () => new Response('<html>Consent</html>'));
  await assert.rejects(missing.loadCatalogPage(catalogRequest), /Donnees YouTube absentes/);
  const consent = loadScraper(async () => ({ ok: true, url: 'https://consent.youtube.com/', text: async () => '' }));
  await assert.rejects(consent.loadCatalogPage(catalogRequest), /consentement/);
  const privatePage = loadScraper(async () => new Response(html({
    alerts: [{ alertRenderer: { type: 'ERROR', text: { simpleText: 'Private playlist' } } }]
  })));
  await assert.rejects(privatePage.resolveInput('https://www.youtube.com/playlist?list=PLtest'), /Private playlist/);
  const unknown = loadScraper(async () => new Response(html(page([{ newUnsupportedRenderer: {} }]))));
  await assert.rejects(unknown.loadCatalogPage(catalogRequest), /non reconnue/);
});

test('resolves handles, channel IDs and playlist URLs without Google', async () => {
  const calls = [];
  const scraper = loadScraper(async (url) => {
    calls.push(url);
    return new Response(html(page([], {
      metadata: { channelMetadataRenderer: { externalId: channelId, title: 'Channel', avatar: {} } }
    })));
  });
  assert.equal((await scraper.resolveInput('@test')).id, channelId);
  assert.equal((await scraper.resolveInput(channelId)).type, 'channel');
  assert.match(calls[0], /youtube\.com\/@test\?/);
  const playlist = loadScraper(async () => new Response(html(page([], {
    metadata: { playlistMetadataRenderer: { title: 'Public playlist' } }
  }))));
  const result = await playlist.resolveInput('https://www.youtube.com/watch?v=abcdefghijk&list=PLtest');
  assert.equal(result.type, 'playlist');
  assert.equal(result.id, 'PLtest');
  await assert.rejects(scraper.resolveInput('https://example.org/@test'), /invalide/);
});

test('search reads public channel results and removes duplicates', async () => {
  const scraper = loadScraper(async (url) => {
    assert.match(url, /\/results\?/);
    const renderer = { channelRenderer: { channelId, title: { simpleText: 'Channel' } } };
    return new Response(html({ contents: [renderer, renderer] }));
  });
  const results = await scraper.searchChannels('test');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, channelId);
});

test('exact dates come from watch metadata and missing dates are errors', async () => {
  const scraper = loadScraper(async () => new Response(html({}, {
    microformat: { playerMicroformatRenderer: { publishDate: '2026-10-17T12:00:00Z' } }
  })));
  assert.equal((await scraper.loadVideoDetails(videoId)).publishDate, '2026-10-17');
  const unavailable = loadScraper(async () => new Response(html({})));
  await assert.rejects(unavailable.loadVideoDetails(videoId), /Date de publication indisponible/);
});

test('client traverses every channel tab and page, deduplicating videos', async () => {
  const requests = [];
  const client = loadClient(async (type, payload) => {
    requests.push([type, payload]);
    if (type === 'YOUTUBE_RESOLVE') return { data: {
      type: 'channel', catalogTabs: ['/channel/test/videos', '/channel/test/shorts', '/channel/test/streams']
    } };
    if (payload.itemType === 'short') return { data: { items: [{ videoId: otherId, itemType: 'short' }], continuation: '' } };
    if (payload.continuation) return { data: { items: [{ videoId }], continuation: '' } };
    return { data: { items: [{ videoId }], continuation: 'next', context } };
  });
  const catalog = await client.reloadCatalog({ id: channelId });
  assert.equal(catalog.totalItems, 2);
  assert.equal(requests.filter(([type]) => type === 'YOUTUBE_CATALOG_PAGE').length, 5);
});

test('repeated tokens and failed continuations do not return partial catalogs', async () => {
  const client = loadClient(async (type) => type === 'YOUTUBE_RESOLVE'
    ? { data: { type: 'playlist', canonicalUrl: 'https://www.youtube.com/playlist?list=PLtest' } }
    : { data: { items: [{ videoId }], continuation: 'repeated', context } });
  await assert.rejects(client.reloadCatalog({ id: 'PLtest' }), /catalogue incomplet/);
  let pages = 0;
  const broken = loadClient(async (type) => {
    if (type === 'YOUTUBE_RESOLVE') return { data: { type: 'playlist', canonicalUrl: 'url' } };
    if (++pages > 1) throw new Error('HTTP 429');
    return { data: { items: [{ videoId }], continuation: 'next', context } };
  });
  await assert.rejects(broken.reloadCatalog({ id: 'PLtest' }), /HTTP 429/);
});

test('date enrichment is lazy, preserves cached dates, and filters inclusively', async () => {
  let requests = 0;
  const client = loadClient(async (type) => {
    assert.equal(type, 'YOUTUBE_VIDEO_DETAILS');
    requests++;
    return { data: { publishDate: '2026-10-17' } };
  });
  const items = [{ videoId, itemType: 'video' }, { videoId: otherId, publishDate: '2026-01-01', itemType: 'short' }];
  await client.prepareItems(items, {});
  assert.equal(requests, 0);
  const filters = { fromDate: '2026-10-17', toDate: '2026-10-17' };
  const prepared = await client.prepareItems(items, filters);
  assert.equal(requests, 1);
  assert.equal(client.filterItems(prepared, filters).length, 1);
  assert.equal(items[0].publishDate, undefined);
  await assert.rejects(client.prepareItems(items, { fromDate: '2026-10-17', toDate: '2026-01-01' }), /date de debut/);
});

test('unknown playlist formats cannot be silently excluded by type filters', () => {
  const client = loadClient(async () => { throw new Error('Unexpected network request'); });
  const items = [{ videoId, itemType: 'unknown' }];
  assert.equal(client.filterItems(items, {}).length, 1);
  assert.equal(client.filterItems(items, { includeLongVideos: false, includeShorts: false }).length, 0);
  assert.throws(() => client.filterItems(items, { includeShorts: false }), /ne distingue pas/);
  assert.throws(() => client.filterItems(items, { fromDate: '2026-01-01' }), /Date de publication manquante/);
  assert.equal(client.filterItems([{ videoId, itemType: 'video' }], { includeShorts: false }).length, 1);
});

test('message bridge rejects runtime errors and missing responses', async () => {
  for (const kind of ['runtime', 'empty', 'background']) {
    const chrome = {
      runtime: {
        lastError: kind === 'runtime' ? { message: 'Extension unavailable' } : null,
        sendMessage: (_, callback) => callback(kind === 'background' ? { error: 'HTTP 429' } : undefined)
      }
    };
    const sandbox = vm.createContext({ chrome });
    vm.runInContext(readFileSync(path.join(root, 'youtube', 'client', 'youtube-client-network.js'), 'utf8'), sandbox);
    await assert.rejects(sandbox.TMYouTubeNetwork.request('YOUTUBE_SEARCH', {}));
  }
});

test('reuses browser consent cookies and recognizes alternate initial-data assignment', async () => {
  const scraper = loadScraper(async (_, options) => {
    assert.equal(options.credentials, 'include');
    return new Response(`<script>window [ 'ytInitialData' ] = ${JSON.stringify(page([video()]))};</script>`);
  });
  assert.equal((await scraper.loadCatalogPage(catalogRequest)).items.length, 1);
});

test('consent forms and anti-bot pages have distinct actionable errors', async () => {
  const consent = loadScraper(async () => new Response('<form action="https://consent.youtube.com/save"></form>'));
  await assert.rejects(consent.searchChannels('Suussonic'), /Consentement YouTube requis.*Accepter ou Refuser/);
  const bot = loadScraper(async () => new Response('<html><div class="g-recaptcha">Verification</div></html>'));
  await assert.rejects(bot.searchChannels('Suussonic'), /bloque temporairement/);
});

function searchHarness(client) {
  let scheduled;
  const messages = [];
  const logs = [];
  const rows = [];
  const container = {
    style: {},
    set innerHTML(value) { this.html = value; rows.length = 0; },
    get innerHTML() { return this.html || ''; },
    appendChild(row) { rows.push(row); }
  };
  const overlay = { isConnected: true, querySelector: () => container };
  const state = { currentSource: 'youtube' };
  const sandbox = vm.createContext({
    TMYouTubeClient: client,
    TMContent: {
      state,
      constants: { MIN_SEARCH_LENGTH: 2, SEARCH_DEBOUNCE_MS: 350 },
      escapeHtml: (value) => value,
      debounce: (fn, delay) => {
        assert.equal(delay, 350);
        return (...args) => { scheduled = () => fn(...args); };
      },
      hideSearchResults: () => { container.innerHTML = ''; container.style.display = 'none'; },
      showMessage: (_, message) => messages.push(message),
      logError: (_, __, message) => logs.push(message)
    },
    document: { createElement: () => ({ addEventListener() {} }) }
  });
  vm.runInContext(readFileSync(path.join(root, 'content', 'search', 'content-search.js'), 'utf8'), sandbox);
  return {
    search: (query) => sandbox.TMContent.performSearch(overlay, query),
    flush: () => scheduled(),
    state, overlay, container, rows, messages, logs
  };
}

test('typing automatically searches after debounce, without Enter, and hides short queries', async () => {
  const calls = [];
  const harness = searchHarness({
    searchChannels: async (query) => {
      calls.push(query);
      return [{ id: channelId, title: 'Suussonic' }];
    }
  });
  harness.search('Su');
  harness.search('Suussonic');
  assert.equal(calls.length, 0);
  await harness.flush();
  assert.deepEqual(calls, ['Suussonic']);
  assert.equal(harness.rows.length, 1);
  assert.match(harness.rows[0].innerHTML, /Suussonic/);
  harness.search('');
  assert.equal(harness.container.style.display, 'none');
  await harness.flush();
  assert.equal(calls.length, 1);
});

test('handles and playlist URLs resolve in the same autocomplete field', async () => {
  const calls = [];
  const harness = searchHarness({
    resolveInput: async (input) => {
      calls.push(input);
      return { id: channelId, title: 'Direct result' };
    },
    searchChannels: async () => assert.fail('A direct input must not use name search')
  });
  for (const value of ['@Suussonic', 'https://www.youtube.com/playlist?list=PLtest', channelId]) {
    harness.search(value);
    await harness.flush();
    assert.equal(harness.rows.length, 1);
  }
  assert.equal(calls.length, 3);
});

test('late search responses cannot replace newer suggestions', async () => {
  let finishOld;
  const harness = searchHarness({
    searchChannels: (query) => query === 'old'
      ? new Promise((resolve) => { finishOld = resolve; })
      : Promise.resolve([{ id: channelId, title: 'New result' }])
  });
  harness.search('old');
  const old = harness.flush();
  harness.search('new');
  await harness.flush();
  finishOld([{ id: channelId, title: 'Old result' }]);
  await old;
  assert.match(harness.rows[0].innerHTML, /New result/);
});

test('stale errors and responses after a source switch or closure are ignored', async () => {
  for (const change of ['source', 'closed', 'cleared']) {
    let reject;
    const harness = searchHarness({
      searchChannels: () => new Promise((_, fail) => { reject = fail; })
    });
    harness.search('query');
    const pending = harness.flush();
    if (change === 'source') harness.state.currentSource = 'steam';
    if (change === 'closed') harness.overlay.isConnected = false;
    if (change === 'cleared') harness.search('');
    reject(new Error('Old failure'));
    await pending;
    assert.equal(harness.logs.length, 0);
    assert.ok(!harness.messages.includes('Old failure'));
  }
});

test('current search failures clear suggestions and are logged visibly', async () => {
  const harness = searchHarness({
    searchChannels: async () => { throw new Error('Consentement YouTube requis'); }
  });
  harness.search('Suussonic');
  await harness.flush();
  assert.equal(harness.container.style.display, 'none');
  assert.equal(harness.messages.at(-1), 'Consentement YouTube requis');
  assert.equal(harness.logs.at(-1), 'Consentement YouTube requis');
});

test('pagination excludes account cookies and forwards visitor and client headers', async () => {
  const browserContext = {
    client: { clientName: 'WEB', clientVersion: 'browser-version', visitorData: 'public-visitor' },
    user: { onBehalfOfUser: 'account-identifier' }
  };
  const scraper = loadScraper(async (_, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers['X-Goog-Visitor-Id'], 'public-visitor');
    assert.equal(options.headers['X-Youtube-Client-Version'], 'browser-version');
    assert.ok(!options.headers.Authorization);
    assert.ok(!options.headers.Cookie);
    const body = JSON.parse(options.body);
    assert.ok(!body.context.user);
    return Response.json({ onResponseReceivedActions: [{
      appendContinuationItemsAction: { continuationItems: [video()] }
    }] });
  });
  const result = await scraper.loadCatalogPage({ continuation: 'token', context: browserContext, itemType: 'video' });
  assert.equal(result.items.length, 1);
});

test('HTTP 403 distinguishes HTML and continuation requests without repeated retries', async () => {
  let requests = 0;
  const scraper = loadScraper(async () => {
    requests++;
    return new Response('', { status: 403 });
  });
  await assert.rejects(scraper.loadCatalogPage(catalogRequest), /page \/@test\/videos \(HTTP 403\)/);
  await assert.rejects(scraper.loadCatalogPage({ continuation: 'next', context, itemType: 'video' }),
    /pagination du catalogue \(HTTP 403\).*cache precedent est conserve/);
  assert.equal(requests, 2);
});

test('catalog errors identify failing tab, page and number already read', async () => {
  let pages = 0;
  const client = loadClient(async (type) => {
    if (type === 'YOUTUBE_RESOLVE') return { data: { type: 'channel', catalogTabs: ['/@test/videos'] } };
    if (++pages === 1) return { data: { items: [{ videoId }], continuation: 'next', context } };
    throw new Error('YouTube refuse la pagination du catalogue (HTTP 403).');
  });
  await assert.rejects(client.reloadCatalog({ id: channelId }),
    /\/@test\/videos \(page suivante, 1 video\(s\) lue\(s\)\).*HTTP 403/);
});

test('failed reload preserves previous cache and registers a retry; success clears reload errors', async () => {
  const profileId = channelId;
  let cache = { items: [{ videoId }], totalItems: 1 };
  const originalCache = cache;
  let fail = true;
  const state = { currentSource: 'youtube', logs: [], youtubeFilters: {} };
  const sandbox = vm.createContext({
    TMStorage: {
      getYouTubeUsers: async () => ({ [profileId]: { id: profileId } }),
      saveYouTubeItemsForUser: async (_, value) => { cache = value; }
    },
    TMYouTubeClient: {
      reloadCatalog: async () => {
        if (fail) throw new Error('HTTP 403');
        return { items: [{ videoId: otherId }], totalItems: 1 };
      }
    },
    TMContent: {
      state, getCurrentDateString: () => '2026-10-17',
      showMessage() {}, showFailedGames() {}, setButtonsBusy() {}, setProgress() {},
      renderUsersList: async () => {}, updateLogsButton() {},
      logError: (_, context, message, extra) => state.logs.push({ context, message, ...extra })
    }
  });
  vm.runInContext(readFileSync(path.join(root, 'content', 'reload', 'content-reload.js'), 'utf8'), sandbox);
  const overlay = { querySelector: () => null };
  await sandbox.TMContent.handleReloadYouTube(overlay, profileId, 'Suussonic');
  assert.equal(cache, originalCache);
  assert.equal(state.logs[0].retryReload.profileId, profileId);
  assert.equal(state.logs[0].retryReload.source, 'youtube');
  fail = false;
  state.logs.push({ context: 'import', message: 'Unrelated error' });
  await sandbox.TMContent.handleReloadYouTube(overlay, profileId, 'Suussonic');
  assert.equal(cache.items[0].videoId, otherId);
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].context, 'import');
});

test('reload log entry offers a working individual catalogue retry', async () => {
  const listeners = {};
  const controls = new Map();
  function control(selector) {
    if (!controls.has(selector)) controls.set(selector, { addEventListener: (event, handler) => { listeners[selector + ':' + event] = handler; } });
    return controls.get(selector);
  }
  const mainOverlay = {};
  let removed = false;
  let markup;
  let retried;
  const logsOverlay = {
    addEventListener() {},
    querySelector: control,
    remove: () => { removed = true; },
    set innerHTML(value) { markup = value; }
  };
  const state = {
    logs: [{ id: 1, time: Date.now(), context: 'reload', message: 'HTTP 403',
      retryReload: { source: 'youtube', profileId: channelId, username: 'Suussonic' } }]
  };
  const sandbox = vm.createContext({
    TMContent: {
      state, constants: { MODAL_ID: 'tm-modal' },
      escapeHtml: (value) => String(value), renderIcon: () => '',
      handleReloadYouTube: async (...args) => { retried = args; }
    },
    document: {
      getElementById: (id) => id === 'tm-modal' ? mainOverlay : null,
      createElement: () => logsOverlay,
      body: { appendChild() {} }
    }
  });
  vm.runInContext(readFileSync(path.join(root, 'content', 'logs', 'content-logs.js'), 'utf8'), sandbox);
  sandbox.TMContent.openLogsModal();
  assert.match(markup, /title="Recharger ce catalogue"/);
  assert.doesNotMatch(markup, /Aucune relance directe disponible/);
  await listeners['#tm-logs-list:click']({
    target: { closest: () => ({ dataset: { logId: '1' } }) }
  });
  assert.equal(removed, true);
  assert.deepEqual(retried, [mainOverlay, channelId, 'Suussonic']);
});

test('extension-origin 403 retries pagination from a YouTube page only', async () => {
  const calls = [];
  const scraper = loadScraper(async () => new Response('', { status: 403 }), {
    TMYouTubePage: {
      browse: async (payload) => {
        calls.push(payload);
        return { onResponseReceivedActions: [{
          appendContinuationItemsAction: { continuationItems: [video(otherId)] }
        }] };
      }
    }
  });
  const result = await scraper.loadCatalogPage({
    ...catalogRequest, continuation: 'token', context
  });
  assert.equal(result.items[0].videoId, otherId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, catalogRequest.url);
  assert.equal(calls[0].continuation, 'token');
  await assert.rejects(scraper.loadCatalogPage(catalogRequest), /HTTP 403/);
  assert.equal(calls.length, 1);
});

test('temporary YouTube tab closes after success and injection failure', async () => {
  for (const failure of [false, true]) {
    const removed = [];
    const listeners = new Set();
    const chrome = {
      tabs: {
        create: async (options) => {
          assert.equal(options.active, false);
          assert.match(options.url, /^https:\/\/www.youtube.com/);
          return { id: 123 };
        },
        get: async () => ({ status: 'complete' }),
        remove: async (id) => { removed.push(id); },
        onUpdated: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
        onRemoved: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) }
      },
      scripting: {
        executeScript: async (options) => {
          assert.equal(options.world, 'MAIN');
          assert.equal(options.target.tabId, 123);
          assert.equal(options.args[1], 'token');
          if (failure) throw new Error('Injection refused');
          return [{ result: { data: { complete: true } } }];
        }
      }
    };
    const sandbox = vm.createContext({ chrome, URL, setTimeout, clearTimeout, console });
    vm.runInContext(readFileSync(path.join(root, 'youtube', 'background', 'youtube-background-page.js'), 'utf8'), sandbox);
    const request = { url: catalogRequest.url, client: context.client, continuation: 'token' };
    if (failure) await assert.rejects(sandbox.TMYouTubePage.browse(request), /Injection refused/);
    else assert.equal((await sandbox.TMYouTubePage.browse(request)).complete, true);
    assert.deepEqual(removed, [123]);
    assert.equal(listeners.size, 0);
    await assert.rejects(sandbox.TMYouTubePage.browse({ ...request, url: 'https://example.org/videos' }), /non autorisee/);
    assert.deepEqual(removed, [123]);
  }
});

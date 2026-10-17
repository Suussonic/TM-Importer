/**
 * Lecture des pages publiques YouTube et de leurs continuations web.
 * Aucune cle ni appel a la YouTube Data API.
 */
(function (global) {
  'use strict';

  const BASE = 'https://www.youtube.com';
  const VIDEO_ID = /^[\w-]{11}$/;

  function text(value) {
    if (typeof value === 'string') return value;
    return value && (value.simpleText || value.content ||
      (value.runs || []).map((run) => run.text).join('')) || '';
  }

  function findAll(value, key, results = []) {
    if (!value || typeof value !== 'object') return results;
    if (value[key]) results.push(value[key]);
    for (const child of Object.values(value)) findAll(child, key, results);
    return results;
  }

  // Les accolades a l'interieur des titres ne doivent pas terminer le JSON.
  function readEmbeddedJson(html, marker) {
    const match = marker.exec(html);
    if (!match) return null;
    const start = match.index + match[0].length;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < html.length; i++) {
      const char = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        return JSON.parse(html.slice(start, i + 1));
      }
    }
    throw new Error('Donnees de la page YouTube tronquees.');
  }

  function assertPageUrl(value) {
    const url = new URL(value, BASE);
    if (url.origin !== BASE || !/^\/(?:channel\/|@|user\/|c\/|playlist$|results$|watch$)/.test(url.pathname)) {
      throw new Error('URL publique YouTube non autorisee.');
    }
    url.searchParams.set('hl', 'en');
    url.searchParams.set('gl', 'US');
    return url;
  }

  async function fetchResponse(url, options = {}) {
    const response = await fetch(url, {
      // Respecte le choix de consentement deja enregistre dans le navigateur.
      // Sans cookies, YouTube peut renvoyer son formulaire a chaque requete.
      credentials: 'include',
      ...options,
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      const stage = new URL(url).pathname === '/youtubei/v1/browse'
        ? 'la pagination du catalogue'
        : `la page ${new URL(url).pathname}`;
      const error = new Error(`YouTube refuse ${stage} (HTTP ${response.status}). Le cache precedent est conserve. Reessayez plus tard.`);
      error.status = response.status;
      throw error;
    }
    if (new URL(response.url || url).origin !== BASE) {
      throw new Error('YouTube demande un consentement ou une connexion. Ouvrez youtube.com dans ce navigateur, choisissez Accepter ou Refuser les cookies, puis relancez la recherche.');
    }
    return response;
  }

  async function loadPage(url) {
    const response = await fetchResponse(assertPageUrl(url).toString());
    const html = await response.text();
    const data = readEmbeddedJson(html, /(?:var\s+ytInitialData\s*=\s*|window\s*\[\s*["']ytInitialData["']\s*\]\s*=\s*|ytInitialData\s*=\s*)(?=\{)/);
    if (!data) {
      if (/<form\b[^>]*\baction=["'][^"']*consent\.youtube\.com/i.test(html) ||
          /consent-bump|before you continue to youtube|avant d'acceder a youtube/i.test(html)) {
        throw new Error('Consentement YouTube requis. Ouvrez youtube.com dans ce navigateur, choisissez Accepter ou Refuser les cookies, puis relancez la recherche.');
      }
      if (/\/sorry\/|g-recaptcha|unusual traffic|not a bot|trafic inhabituel/i.test(html)) {
        throw new Error('YouTube bloque temporairement les requetes automatisees. Ouvrez youtube.com pour consulter le message, puis reessayez plus tard.');
      }
      throw new Error('Donnees YouTube absentes de la page. Rechargez YouTube dans ce navigateur, puis reessayez. Si cela persiste, le format de la page doit etre adapte.');
    }
    const alerts = findAll(data.alerts, 'alertRenderer');
    const error = alerts.find((alert) => alert.type === 'ERROR');
    if (error) throw new Error(text(error.text) || 'Source YouTube indisponible.');
    const context = readEmbeddedJson(html, /"INNERTUBE_CONTEXT"\s*:\s*(?=\{)/);
    return { data, html, context };
  }

  function thumbnail(value) {
    const images = value && (value.thumbnails || value.sources) || [];
    return images.length ? images[images.length - 1].url : '';
  }

  function channelProfile(metadata, data) {
    const tabs = findAll(data.contents, 'tabRenderer').map((tab) =>
      tab.endpoint && tab.endpoint.commandMetadata && tab.endpoint.commandMetadata.webCommandMetadata &&
      tab.endpoint.commandMetadata.webCommandMetadata.url
    ).filter((url) => /\/(?:videos|shorts|streams)$/.test(url || ''));
    return {
      id: metadata.externalId,
      type: 'channel',
      title: metadata.title,
      avatar: thumbnail(metadata.avatar),
      canonicalUrl: `${BASE}/channel/${metadata.externalId}`,
      catalogTabs: tabs
    };
  }

  async function searchChannels(query) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('Saisissez un nom de chaine YouTube.');
    const url = new URL('/results', BASE);
    url.searchParams.set('search_query', query.trim());
    url.searchParams.set('sp', 'EgIQAg==');
    const { data } = await loadPage(url.toString());
    const seen = new Set();
    return findAll(data.contents, 'channelRenderer').filter((item) => {
      if (!item.channelId || seen.has(item.channelId)) return false;
      seen.add(item.channelId);
      return true;
    }).slice(0, 8).map((item) => ({
      id: item.channelId,
      type: 'channel',
      title: text(item.title),
      avatar: thumbnail(item.thumbnail),
      canonicalUrl: `${BASE}/channel/${item.channelId}`
    }));
  }

  async function resolveInput(input) {
    const value = String(input || '').trim();
    if (!value) throw new Error('Saisissez une chaine ou une playlist YouTube.');
    let url;
    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value);
      if (!['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(parsed.hostname) ||
          parsed.protocol !== 'https:') throw new Error('URL YouTube invalide.');
      if (parsed.searchParams.has('list')) {
        url = `${BASE}/playlist?list=${encodeURIComponent(parsed.searchParams.get('list'))}`;
      } else if (/^\/(?:channel\/[\w-]+|@[^/]+|user\/[^/]+|c\/[^/]+)/.test(parsed.pathname)) {
        url = `${BASE}/${parsed.pathname.split('/').filter(Boolean).slice(0, parsed.pathname.startsWith('/@') ? 1 : 2).join('/')}`;
      } else throw new Error('Utilisez une URL de chaine ou de playlist YouTube.');
    } else if (/^UC[\w-]{22}$/.test(value)) url = `${BASE}/channel/${value}`;
    else if (/^(?:PL|UU|FL|OL)[\w-]{16,}$/.test(value)) url = `${BASE}/playlist?list=${value}`;
    else if (value.startsWith('@')) url = `${BASE}/${encodeURIComponent(value).replace('%40', '@')}`;
    else {
      const results = await searchChannels(value);
      if (!results.length) throw new Error('Chaine YouTube introuvable.');
      url = results[0].canonicalUrl;
    }
    const { data } = await loadPage(url);
    const channel = data.metadata && data.metadata.channelMetadataRenderer;
    if (channel && channel.externalId) return channelProfile(channel, data);
    const playlist = data.metadata && data.metadata.playlistMetadataRenderer;
    if (playlist && new URL(url).searchParams.get('list')) {
      const sidebar = findAll(data.sidebar, 'playlistSidebarPrimaryInfoRenderer')[0];
      const image = findAll(sidebar, 'playlistVideoThumbnailRenderer')[0];
      return {
        id: new URL(url).searchParams.get('list'),
        type: 'playlist',
        title: playlist.title,
        avatar: thumbnail(image && image.thumbnail),
        canonicalUrl: url
      };
    }
    throw new Error('Chaine ou playlist publique YouTube introuvable.');
  }

  function extractItems(root, itemType) {
    const items = new Map();
    function add(id, title, type, renderer) {
      if (!VIDEO_ID.test(id || '') || !title || renderer.isPlayable === false) return;
      items.set(id, {
        id, videoId: id, title,
        thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        publishDate: '',
        itemType: type,
        url: `${BASE}/watch?v=${id}`
      });
    }
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      const legacy = value.videoRenderer || value.gridVideoRenderer || value.playlistVideoRenderer;
      if (legacy) {
        const shorts = findAll(legacy, 'thumbnailOverlayTimeStatusRenderer').some((overlay) => overlay.style === 'SHORTS');
        add(legacy.videoId, text(legacy.title), shorts ? 'short' : itemType, legacy);
        return;
      }
      const short = value.shortsLockupViewModel || value.reelItemRenderer;
      if (short) {
        const endpoint = findAll(short, 'reelWatchEndpoint')[0];
        add(short.videoId || (endpoint && endpoint.videoId),
          text(short.headline) || text(short.overlayMetadata && short.overlayMetadata.primaryText), 'short', short);
        return;
      }
      const lockup = value.lockupViewModel;
      if (lockup) {
        if (lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
          const metadata = lockup.metadata && lockup.metadata.lockupMetadataViewModel;
          add(lockup.contentId, text(metadata && metadata.title), itemType, lockup);
        }
        return;
      }
      for (const child of Object.values(value)) visit(child);
    }
    visit(root);
    return [...items.values()];
  }

  function continuationToken(root) {
    const continuations = [
      ...findAll(root, 'continuationItemRenderer'),
      ...findAll(root, 'continuationItemViewModel')
    ];
    for (const item of continuations) {
      const command = findAll(item, 'continuationCommand').find((command) => command.token);
      if (command) return command.token;
    }
    return '';
  }

  function pageResult(root, context, itemType) {
    return { items: extractItems(root, itemType), continuation: continuationToken(root), context };
  }

  async function loadCatalogPage({ url, continuation, context, itemType }) {
    if (!['video', 'short', 'unknown'].includes(itemType)) throw new Error('Type de catalogue YouTube invalide.');
    if (!continuation) {
      const page = await loadPage(url);
      const selected = findAll(page.data.contents, 'tabRenderer').find((tab) => tab.selected);
      if (!selected || !selected.content) throw new Error('Catalogue YouTube introuvable.');
      // YouTube peut rediriger un onglet absent vers la page Accueil.
      const selectedUrl = selected.endpoint && selected.endpoint.commandMetadata &&
        selected.endpoint.commandMetadata.webCommandMetadata && selected.endpoint.commandMetadata.webCommandMetadata.url;
      const expected = new URL(url, BASE).pathname.match(/\/(videos|shorts|streams)$/);
      if (expected && selectedUrl && !selectedUrl.endsWith(`/${expected[1]}`)) {
        throw new Error('Onglet YouTube indisponible pour cette chaine.');
      }
      const result = pageResult(selected.content, page.context, itemType);
      if (!result.items.length && !findAll(selected.content, 'messageRenderer').length) {
        throw new Error('Liste de videos YouTube non reconnue. Le site a peut-etre change.');
      }
      return result;
    }
    if (typeof continuation !== 'string' || !context || !context.client ||
        context.client.clientName !== 'WEB' || !context.client.clientVersion) {
      throw new Error('Pagination YouTube invalide.');
    }
    const { clientVersion, visitorData } = context.client;
    const client = { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' };
    if (visitorData) client.visitorData = visitorData;
    const headers = {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': clientVersion
    };
    if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;
    // Un POST avec les cookies d'un compte Google exige une signature de
    // session que l'extension ne genere pas. Pagination publique anonyme.
    let data;
    try {
      const response = await fetchResponse(`${BASE}/youtubei/v1/browse?prettyPrint=false`, {
        method: 'POST',
        credentials: 'omit',
        headers,
        body: JSON.stringify({ context: { client }, continuation })
      });
      data = await response.json();
    } catch (error) {
      if (error.status !== 403 || !global.TMYouTubePage) throw error;
      data = await global.TMYouTubePage.browse({ url, client, continuation });
    }
    if (data.error) throw new Error(data.error.message || 'Pagination YouTube refusee.');
    const actions = [...(data.onResponseReceivedActions || []), ...(data.onResponseReceivedEndpoints || [])];
    // Certaines playlists exposent un dernier jeton meme apres leur dernier
    // element ; YouTube renvoie alors uniquement ce contexte de succes.
    if (data.responseContext && data.trackingParams && Object.keys(data).every((key) =>
      ['responseContext', 'trackingParams'].includes(key))) {
      return pageResult([], context, itemType);
    }
    const chunks = actions.flatMap((action) => {
      const command = action.appendContinuationItemsAction || action.reloadContinuationItemsCommand;
      return command ? command.continuationItems || [] : [];
    });
    if (!chunks.length && !actions.some((action) => action.appendContinuationItemsAction || action.reloadContinuationItemsCommand)) {
      throw new Error('Reponse de pagination YouTube non reconnue : catalogue non enregistre.');
    }
    const result = pageResult(chunks, context, itemType);
    if (chunks.length && !result.items.length && !findAll(chunks, 'messageRenderer').length) {
      throw new Error('Suite du catalogue YouTube illisible : catalogue non enregistre.');
    }
    return result;
  }

  async function loadVideoDetails(videoId) {
    if (!VIDEO_ID.test(videoId || '')) throw new Error('Identifiant de video YouTube invalide.');
    const page = await loadPage(`${BASE}/watch?v=${videoId}`);
    const player = readEmbeddedJson(page.html, /(?:var\s+ytInitialPlayerResponse\s*=\s*|ytInitialPlayerResponse\s*=\s*)(?=\{)/);
    const metadata = player && player.microformat && player.microformat.playerMicroformatRenderer;
    const date = metadata && (metadata.publishDate || metadata.uploadDate);
    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
      throw new Error(`Date de publication indisponible pour ${videoId}. Filtrage par date impossible.`);
    }
    return { publishDate: date.slice(0, 10) };
  }

  global.TMYouTubeScrape = { searchChannels, resolveInput, loadCatalogPage, loadVideoDetails };
})(typeof self !== 'undefined' ? self : this);

(function (global) {
  'use strict';

  const { request } = global.TMYouTubeNetwork;

  async function searchChannels(query) {
    return (await request('YOUTUBE_SEARCH', { query })).data;
  }

  async function resolveInput(input) {
    return (await request('YOUTUBE_RESOLVE', { input })).data;
  }

  async function fetchThumbnail(url, videoId) {
    return (await request('FETCH_YOUTUBE_IMAGE', { url, videoId })).dataUrl;
  }

  async function reloadCatalog(profile, { onProgress } = {}) {
    const resolved = await resolveInput(profile.canonicalUrl || profile.id);
    const sources = resolved.type === 'playlist'
      ? [{ url: resolved.canonicalUrl, itemType: 'unknown' }]
      : (resolved.catalogTabs || []).map((url) => ({
        url, itemType: url.endsWith('/shorts') ? 'short' : 'video'
      }));
    const items = new Map();
    for (const source of sources) {
      const seen = new Set();
      let continuation = '';
      let context;
      do {
        let page;
        try {
          page = (await request('YOUTUBE_CATALOG_PAGE', { ...source, continuation, context })).data;
        } catch (err) {
          const stage = continuation ? 'page suivante' : 'premiere page';
          throw new Error(`${source.url} (${stage}, ${items.size} video(s) lue(s)) : ${err.message || err}`);
        }
        for (const item of page.items) items.set(item.videoId, item);
        if (onProgress) onProgress(items.size);
        continuation = page.continuation;
        context = page.context;
        if (continuation && seen.has(continuation)) {
          throw new Error('Pagination YouTube repetee : catalogue incomplet, non enregistre.');
        }
        seen.add(continuation);
      } while (continuation);
    }
    return {
      items: [...items.values()],
      totalItems: items.size,
      firstPublishedAt: '',
      lastPublishedAt: '',
      scraped: true
    };
  }

  // Les listes publiques affichent des dates relatives. Lire la page video
  // seulement quand un filtre de date exige une date exacte.
  async function prepareItems(items, filters, onProgress) {
    const needsDates = !!(filters.fromDate || filters.toDate);
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      throw new Error('La date de debut doit preceder la date de fin.');
    }
    if (!needsDates) return items;
    const prepared = [];
    for (const item of items) {
      let next = item;
      if (needsDates && !item.publishDate) {
        const details = (await request('YOUTUBE_VIDEO_DETAILS', { videoId: item.videoId || item.id })).data;
        next = { ...item, ...details };
      }
      prepared.push(next);
      if (onProgress) onProgress(prepared.length, items.length);
    }
    return prepared;
  }

  function filterItems(items, filters) {
    const includeVideos = filters.includeLongVideos !== false;
    const includeShorts = filters.includeShorts !== false;
    if (!includeVideos && !includeShorts) return [];
    return (items || []).filter((item) => {
      if (filters.fromDate || filters.toDate) {
        if (!item.publishDate) throw new Error('Date de publication manquante : rechargez les metadonnees.');
        if (filters.fromDate && item.publishDate < filters.fromDate) return false;
        if (filters.toDate && item.publishDate > filters.toDate) return false;
      }
      if (includeVideos !== includeShorts && (!item.itemType || item.itemType === 'unknown')) {
        throw new Error('YouTube ne distingue pas toujours les Shorts dans les playlists. Cochez Videos et Shorts, ou utilisez une chaine.');
      }
      if (!includeVideos && item.itemType !== 'short') return false;
      if (!includeShorts && item.itemType === 'short') return false;
      return true;
    });
  }

  global.TMYouTubeClient = { searchChannels, resolveInput, reloadCatalog, prepareItems, filterItems, fetchThumbnail };
})(typeof window !== 'undefined' ? window : this);

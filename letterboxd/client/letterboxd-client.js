(function (global) {
  'use strict';

  const parser = global.TMLetterboxdParser;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 300));

  function request(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!response) reject(new Error('Le service Letterboxd ne répond pas.'));
        else if (response.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }

  async function loadPage(url) {
    const response = await request('LETTERBOXD_PAGE', { url });
    if (typeof response.html !== 'string') throw new Error('Réponse Letterboxd invalide.');
    return response.html;
  }

  async function resolveInput(input, kind) {
    const profile = parser.normalizeProfile(input, kind);
    return parser.parseProfile(await loadPage(profile.canonicalUrl), profile);
  }

  function catalogUrl(profile, collection) {
    const normalized = parser.normalizeProfile(profile.canonicalUrl, profile.type);
    if (normalized.id !== profile.id) throw new Error('Source Letterboxd incohérente : supprimez-la puis ajoutez-la à nouveau.');
    if (profile.type === 'director') return profile.canonicalUrl;
    const suffix = { watched: 'films/', rated: 'films/', liked: 'likes/films/', reviewed: 'reviews/films/', watchlist: 'watchlist/' }[collection];
    if (!suffix) throw new Error('Catalogue Letterboxd invalide.');
    return profile.canonicalUrl + suffix;
  }

  async function reloadCatalog(profile, filters, onProgress) {
    const f = global.TMLetterboxdFilters.validate(filters, profile.type);
    const rootUrl = catalogUrl(profile, f.collection);
    let url = rootUrl;
    const pages = new Set();
    const items = new Map();
    let avatar = '';
    while (url) {
      const parsedUrl = new URL(url);
      if (parsedUrl.origin !== 'https://letterboxd.com' || parsedUrl.search || parsedUrl.hash ||
          !(url === rootUrl || new RegExp(`^${rootUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}page/[1-9]\\d*/$`).test(url))) {
        throw new Error('Lien de pagination Letterboxd non autorisé.');
      }
      if (pages.has(url)) throw new Error('Pagination Letterboxd répétée : catalogue incomplet, ancien cache conservé.');
      pages.add(url);
      try {
        const page = parser.parseCatalog(await loadPage(url), url, f.collection, profile.type);
        if (pages.size === 1) avatar = page.avatar;
        for (const item of page.items) {
          // Une critique par visionnage peut répéter un film : une seule affiche.
          if (!items.has(item.id)) items.set(item.id, item);
        }
        onProgress?.(items.size, pages.size);
        url = page.nextUrl;
      } catch (error) {
        throw new Error(`Letterboxd, page ${pages.size} (${items.size} film(s) lus) : ${error.message}`);
      }
      if (url) await pause();
    }
    if (profile.type === 'member' && f.collection === 'rated' && [...items.values()].some((item) => !item.ratingKnown)) {
      throw new Error('Les notes publiques manquent dans ce catalogue Letterboxd : sélection des films notés impossible.');
    }
    const catalog = [...items.values()].filter((item) => profile.type === 'director' || f.collection !== 'rated' || item.rating != null);
    return { items: catalog, collection: profile.type === 'director' ? 'filmography' : f.collection, totalItems: catalog.length, avatar };
  }

  async function prepareItems(items, onProgress) {
    const prepared = [];
    for (const item of items) {
      if (!item.detailsLoaded) {
        if (prepared.length) await pause();
        const details = parser.parseFilm(await loadPage(`https://letterboxd.com/film/${item.slug}/`), item.slug);
        prepared.push({ ...item, ...details, year: details.year || item.year });
      } else {
        prepared.push(item);
      }
      onProgress?.(prepared.length, items.length);
    }
    return prepared;
  }

  async function fetchPoster(item) {
    let posterUrl = item.posterUrl;
    if (!posterUrl) {
      await pause();
      const [prepared] = await prepareItems([item]);
      posterUrl = prepared.posterUrl;
    }
    if (!posterUrl) throw new Error(`Aucune affiche publique disponible pour "${item.name}".`);
    const response = await request('LETTERBOXD_IMAGE', { url: parser.highResolutionPoster(posterUrl) });
    if (typeof response.dataUrl !== 'string' || !response.dataUrl.startsWith('data:image/')) {
      throw new Error("Réponse d'affiche Letterboxd invalide.");
    }
    return response.dataUrl;
  }

  global.TMLetterboxdClient = { resolveInput, reloadCatalog, prepareItems, fetchPoster, catalogUrl };
})(typeof window !== 'undefined' ? window : this);

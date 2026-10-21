(function (global) {
  'use strict';

  const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;

  function getProfileImage(doc, type) {
    const image = type === 'director'
      ? doc.querySelector('.contributor-image img')
      : doc.querySelector('.profile-header .avatar img, .profile-avatar img');
    const value = image?.getAttribute('data-image') || image?.getAttribute('src') || '';
    if (!value) return '';
    const url = new URL(value, 'https://letterboxd.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['a.ltrbxd.com', 's.ltrbxd.com', 'image.tmdb.org'].includes(url.hostname) ||
        /\/(?:empty[^/]*|default-share[^/]*)\./i.test(url.pathname)) return '';
    return url.href;
  }

  function parseDocument(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (/Just a moment|Access denied|Attention Required|^Sign in\b/i.test(doc.title) ||
        doc.querySelector('#challenge-form')) {
      throw new Error('Letterboxd demande une connexion ou bloque la lecture de cette page publique.');
    }
    return doc;
  }

  function normalizeProfile(input, kind = 'member') {
    if (!['member', 'director'].includes(kind)) throw new Error('Type de source Letterboxd invalide.');
    let value = String(input || '').trim();
    if (/^(?:https?:\/\/|www\.|letterboxd\.com)/i.test(value)) {
      if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['letterboxd.com', 'www.letterboxd.com'].includes(url.hostname) ||
          url.port || url.username || url.password || url.search || url.hash) {
        throw new Error('Utilisez une URL publique https://letterboxd.com/.');
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'director' && parts.length === 2) {
        kind = 'director';
        value = parts[1];
      } else if (parts.length === 1 && !['film', 'films', 'director', 'search', 'sign-in'].includes(parts[0])) {
        kind = 'member';
        value = parts[0];
      } else {
        throw new Error('Collez l’URL du profil ou du réalisateur, pas celle d’un film ou d’une critique.');
      }
    } else {
      value = value.replace(/^@/, '').toLowerCase();
      if (kind === 'director') {
        value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
      }
    }
    if (!SLUG.test(value)) throw new Error('Pseudo ou identifiant de réalisateur Letterboxd invalide.');
    value = value.toLowerCase();
    return {
      id: `${kind}:${value}`, type: kind, slug: value,
      canonicalUrl: `https://letterboxd.com/${kind === 'director' ? 'director/' : ''}${value}/`
    };
  }

  function parseProfile(html, profile) {
    const doc = parseDocument(html);
    const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title;
    const marker = profile.type === 'director'
      ? doc.querySelector('.poster-grid, .film-list, .poster-list')
      : doc.querySelector('.profile-header, .profile-name');
    if (!title || !marker) {
      throw new Error('Profil Letterboxd introuvable, privé ou format de page non reconnu.');
    }
    const name = profile.type === 'director'
      ? title.replace(/^Films directed by\s+/i, '').replace(/\s*[•·].*$/, '')
      : doc.querySelector('.profile-name')?.textContent.trim() || title.replace(/’s profile.*|\'s profile.*| • Letterboxd.*$/i, '');
    return { ...profile, title: name.trim(), avatar: getProfileImage(doc, profile.type) };
  }

  function parseCatalog(html, url, collection, type) {
    const doc = parseDocument(html);
    const content = doc.querySelector('main#content') || doc;
    const findCatalogElement = (selector) => [...content.querySelectorAll(selector)]
      .find((element) => !element.closest('.modal, [role="dialog"], template, .js-poster-preview'));
    const container = findCatalogElement('.poster-grid, .film-list, .poster-list, .film-detail-list, .viewing-list');
    const empty = findCatalogElement('.empty, .empty-message, .no-results');
    if (!container && !empty) throw new Error('Catalogue Letterboxd non reconnu : aucun cache partiel enregistré.');
    const items = [];
    for (const row of container ? container.querySelectorAll('li.griditem, li.poster-container, li.film-detail, article.production-viewing') : []) {
      const poster = row.querySelector('[data-item-slug], [data-film-slug]');
      if (!poster) throw new Error('Film Letterboxd non reconnu dans le catalogue : ancien cache conservé.');
      const slug = poster.getAttribute('data-item-slug') || poster.getAttribute('data-film-slug');
      if (!SLUG.test(slug)) throw new Error('Identifiant de film Letterboxd invalide.');
      const fullName = poster.getAttribute('data-item-name') || poster.getAttribute('data-film-name') ||
        row.querySelector('h2, h3')?.textContent.trim() || poster.querySelector('img')?.getAttribute('alt');
      if (!fullName) throw new Error(`Titre Letterboxd manquant pour ${slug}.`);
      const yearMatch = fullName.match(/\((\d{4})\)$/);
      const ratingClass = row.querySelector('.rating')?.getAttribute('class') || '';
      const rating = ratingClass.match(/\brated-(10|[1-9])\b/);
      const stars = row.querySelector('.inline-rating [aria-label]')?.getAttribute('aria-label') || '';
      const starRating = /^[\u2605\u00bd]+$/.test(stars)
        ? [...stars].reduce((total, char) => total + (char === '\u00bd' ? 0.5 : 1), 0) : null;
      const userData = type === 'member' && collection !== 'watchlist';
      const reactions = row.querySelector('.poster-viewingdata, .content-reactions-strip');
      const liked = !!row.querySelector('.icon-liked, .liked-micro, .inline-liked');
      items.push({
        id: slug, slug, name: fullName.replace(/\s+\(\d{4}\)$/, ''),
        year: yearMatch ? Number(yearMatch[1]) : null,
        rating: userData ? (rating ? Number(rating[1]) / 2 : starRating) : null,
        ratingKnown: userData && !!(reactions || row.querySelector('.rating, .inline-rating')),
        liked: !userData ? null : collection === 'liked' || liked ? true : reactions ? false : null,
        reviewed: collection === 'reviewed',
        filmUrl: `https://letterboxd.com/film/${slug}/`
      });
    }
    if (container && items.length === 0 && !empty &&
        !/no films|hasn.t (?:watched|liked|reviewed|added)|no matching|nothing here/i.test(container.textContent)) {
      throw new Error('Liste Letterboxd vide ou HTML modifié : impossible de garantir un catalogue complet.');
    }
    const nextLink = findCatalogElement('a.next, a[rel="next"]');
    const nextUrl = nextLink ? new URL(nextLink.getAttribute('href'), url).href : null;
    return { items, nextUrl, avatar: getProfileImage(doc, type) };
  }

  function highResolutionPoster(value) {
    if (!value) return '';
    const url = new URL(value);
    if (url.origin === 'https://a.ltrbxd.com' && url.pathname.startsWith('/resized/film-poster/')) {
      url.pathname = url.pathname.replace(/-0-(\d+)-0-(\d+)-crop(\.[a-z]+)$/i,
        (match, width, height, extension) => Number(width) < 1000 && Number(height) < 1500
          ? `-0-1000-0-1500-crop${extension}` : match);
    }
    return url.href;
  }

  function parseFilm(html, slug) {
    const doc = parseDocument(html);
    const objects = [];
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      const text = script.textContent.replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\/|\s*\/\*\s*\]\]>\s*\*\/\s*$/g, '');
      const parsed = JSON.parse(text);
      const entries = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
      objects.push(...entries);
    }
    const film = objects.find((item) => [item['@type']].flat().some((value) => ['Movie', 'TVSeries'].includes(value)));
    if (!film || !film.name) throw new Error(`Métadonnées du film "${slug}" absentes ou non reconnues.`);
    const filmUrl = film.url || film['@id'];
    if (filmUrl && filmUrl !== `https://letterboxd.com/film/${slug}/`) {
      throw new Error(`La fiche Letterboxd reçue ne correspond pas au film "${slug}".`);
    }
    const names = (value) => (Array.isArray(value) ? value : value ? [value] : [])
      .map((entry) => typeof entry === 'string' ? entry : entry.name).filter(Boolean);
    const links = (prefix) => [...doc.querySelectorAll(`a[href^="/films/${prefix}/"]`)]
      .map((link) => link.textContent.trim()).filter(Boolean);
    const duration = String(film.duration || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
    const average = film.aggregateRating;
    const image = typeof film.image === 'string' ? film.image : film.image?.url;
    const releaseDate = film.datePublished || film.dateCreated || '';
    return {
      name: film.name, year: /^\d{4}/.test(releaseDate) ? Number(releaseDate.slice(0, 4)) : null,
      posterUrl: highResolutionPoster(image), duration: duration ? Number(duration[1] || 0) * 60 + Number(duration[2] || 0) : null,
      averageRating: average && Number(average.bestRating) > 0
        ? Number(average.ratingValue) * 5 / Number(average.bestRating) : null,
      genres: names(film.genre),
      directors: names(film.director), actors: names(film.actor || film.actors),
      countries: [...new Set([...links('country'), ...names(film.countryOfOrigin)])],
      languages: [...new Set([...links('language'), ...names(film.inLanguage)])],
      detailsLoaded: true
    };
  }

  global.TMLetterboxdParser = { normalizeProfile, parseProfile, parseCatalog, parseFilm, highResolutionPoster };
})(typeof window !== 'undefined' ? window : this);

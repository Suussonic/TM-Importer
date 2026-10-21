(function (global) {
  'use strict';

  const DEFAULTS = {
    collection: 'watched', ratingMin: '', ratingMax: '', rated: 'any', liked: 'any',
    yearMin: '', yearMax: '', durationMin: '', durationMax: '',
    averageMin: '', averageMax: '', title: '', genres: '', countries: '', languages: '',
    director: '', actor: '', sort: 'catalog', descending: false, limit: ''
  };
  const COLLECTIONS = { watched: 'Vus', liked: 'Aimés', rated: 'Notés', reviewed: 'Avec critique', watchlist: 'Watchlist' };
  const SORTS = { catalog: 'Ordre du catalogue', title: 'Titre', year: 'Année', rating: 'Note du compte', averageRating: 'Note moyenne', duration: 'Durée' };
  const normalize = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function validate(filters, type = 'member') {
    const f = { ...DEFAULTS, ...filters };
    if (!Object.hasOwn(COLLECTIONS, f.collection) || !Object.hasOwn(SORTS, f.sort) ||
        !['any', 'yes', 'no'].includes(f.rated) || !['any', 'yes', 'no'].includes(f.liked)) {
      throw new Error('Filtre Letterboxd invalide.');
    }
    for (const [prefix, max, step] of [['rating', 5, 0.5], ['average', 5, 0.01], ['year', 9999, 1], ['duration', 100000, 1]]) {
      for (const suffix of ['Min', 'Max']) {
        const value = f[prefix + suffix];
        if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > max ||
            Math.abs(Number(value) / step - Math.round(Number(value) / step)) > 1e-7)) {
          throw new Error(`Valeur invalide pour ${prefix}${suffix}.`);
        }
      }
      if (f[prefix + 'Min'] !== '' && f[prefix + 'Max'] !== '' &&
          Number(f[prefix + 'Min']) > Number(f[prefix + 'Max'])) {
        throw new Error(`La borne minimale ${prefix} dépasse la borne maximale.`);
      }
    }
    if (f.limit !== '' && (!Number.isSafeInteger(Number(f.limit)) || Number(f.limit) < 1)) {
      throw new Error("La limite d'import doit être un entier positif, ou rester vide pour tout importer.");
    }
    const userFilters = f.rated !== 'any' || f.liked !== 'any' || f.ratingMin !== '' || f.ratingMax !== '' || f.sort === 'rating';
    if (userFilters && (type === 'director' || f.collection === 'watchlist')) {
      throw new Error('Les notes et likes du compte ne sont disponibles que pour ses films vus/aimés/notés/avec critique, pas pour une filmographie ou la watchlist.');
    }
    if (f.rated === 'no' && (f.collection === 'rated' || f.ratingMin !== '' || f.ratingMax !== '')) {
      throw new Error('Le filtre « Sans note » est incompatible avec une sélection de films notés.');
    }
    if (type === 'member' && f.collection === 'liked' && f.liked === 'no') {
      throw new Error('Le catalogue « Aimés » est incompatible avec « Non aimés ».');
    }
    return f;
  }

  function filterItems(items, filters, type = 'member') {
    const f = validate(filters, type);
    let result = items.filter((item) => {
      if (item.ratingKnown === false &&
          (f.collection === 'rated' && type === 'member' || f.rated !== 'any' || f.ratingMin !== '' || f.ratingMax !== '' || f.sort === 'rating')) {
        throw new Error(`Note publique inconnue pour "${item.name}" : filtrage ou tri impossible.`);
      }
      if (type === 'member' && f.collection === 'rated' && item.rating == null) return false;
      if (f.rated === 'yes' && item.rating == null || f.rated === 'no' && item.rating != null) return false;
      if (f.liked !== 'any') {
        if (item.liked == null) throw new Error(`Statut aimé inconnu pour "${item.name}".`);
        if (item.liked !== (f.liked === 'yes')) return false;
      }
      if (f.title && !normalize(item.name).includes(normalize(f.title))) return false;
      for (const [prefix, key] of [['rating', 'rating'], ['year', 'year'], ['duration', 'duration'], ['average', 'averageRating']]) {
        if (f[prefix + 'Min'] === '' && f[prefix + 'Max'] === '') continue;
        if (item[key] == null || !Number.isFinite(item[key])) {
          if (key === 'rating') return false;
          throw new Error(`Donnée ${prefix} indisponible pour "${item.name}" : filtrage exact impossible.`);
        }
        if (f[prefix + 'Min'] !== '' && item[key] < Number(f[prefix + 'Min']) ||
            f[prefix + 'Max'] !== '' && item[key] > Number(f[prefix + 'Max'])) return false;
      }
      for (const [field, key] of [['genres', 'genres'], ['countries', 'countries'], ['languages', 'languages'], ['director', 'directors'], ['actor', 'actors']]) {
        if (!f[field]) continue;
        if (!item.detailsLoaded || !Array.isArray(item[key]) || !item[key].length) {
          throw new Error(`Donnée ${field} indisponible pour "${item.name}".`);
        }
        const choices = f[field].split(',').map(normalize).filter(Boolean);
        if (!choices.some((choice) => item[key].some((value) => normalize(value).includes(choice)))) return false;
      }
      return true;
    });
    if (f.sort !== 'catalog') {
      const key = f.sort === 'title' ? 'name' : f.sort;
      result.sort((a, b) => {
        if (a[key] == null) return b[key] == null ? 0 : 1;
        if (b[key] == null) return -1;
        const comparison = key === 'name' ? a.name.localeCompare(b.name, 'fr') : a[key] - b[key];
        return f.descending ? -comparison : comparison;
      });
    } else if (f.descending) {
      result.reverse();
    }
    return f.limit === '' ? result : result.slice(0, Number(f.limit));
  }

  global.TMLetterboxdFilters = { DEFAULTS, COLLECTIONS, SORTS, validate, filterItems };
})(typeof window !== 'undefined' ? window : this);

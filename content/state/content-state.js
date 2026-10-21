/**
 * content/content-state.js
 *
 * Constantes, etat partage de la modale et petites fonctions utilitaires
 * utilisees par tous les autres modules `content/*.js`. Ce fichier doit etre
 * charge en premier : il cree l'espace de nommage partage `window.TMContent`
 * que les modules suivants completent au fur et a mesure.
 */
(function (global) {
  'use strict';

  const constants = {
    UPLOAD_INPUT_SELECTOR: '#extra-images-input',
    IMPORT_BUTTON_ID: 'tm-import-btn',
    MODAL_ID: 'tm-modal',
    SEARCH_DEBOUNCE_MS: 350,
    MIN_SEARCH_LENGTH: 2,

    SOURCES: {
      steam: { id: 'steam', label: 'Steam', logoUrl: 'https://store.steampowered.com/favicon.ico' },
      youtube: { id: 'youtube', label: 'YouTube', logoUrl: 'https://www.youtube.com/favicon.ico' },
      letterboxd: { id: 'letterboxd', label: 'Letterboxd', logoUrl: 'https://letterboxd.com/favicon.ico' }
    },

    // Filtre du type de jeu Steam a recuperer : succes 100%, bibliotheque
    // complete (Possede) ou jeux avec du temps de jeu enregistre (Joue).
    STEAM_GAME_FILTERS: [
      { value: '100', label: '100%', statsLabel: 'jeu(x) a 100%' },
      { value: 'owned', label: 'Possédé', statsLabel: 'jeu(x) possédé(s)' },
      { value: 'played', label: 'Joué', statsLabel: 'jeu(x) joué(s)' }
    ],

    // Anciens identifiants de type d'image (avant la correction des noms de
    // formats), conserves pour migrer en douceur les reglages deja stockes.
    LEGACY_IMAGE_TYPE_MAP: { title: 'capsule', banner: 'hero' }
  };

  /** Etat courant de la modale, remis a zero a chaque ouverture (voir content-events.js). */
  const state = {
    currentSource: 'steam',
    imageType: 'header',
    steamGameFilter: '100',
    steamAuth: { connected: false, steamId: '', personaname: '', avatar: '' },
    youtubeFilters: { fromDate: '', toDate: '', includeLongVideos: true, includeShorts: true },
    letterboxdFilters: {},
    letterboxdKind: 'member',
    logs: [],
    nextLogId: 1,
    failedImports: [],
    fileInput: null
  };

  /** Nettoie un nom de jeu pour en faire un nom de fichier valide. */
  function sanitizeFilename(name) {
    return String(name).replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 60) || 'jeu';
  }

  /** Formate un timestamp en date lisible (fr-FR). */
  function formatDate(timestamp) {
    if (!timestamp) return 'jamais';
    return timestamp ? new Date(timestamp).toLocaleString('fr-FR') : 'jamais';
  }

  /** Rend une icone SVG inline enregistree dans lib/icons.js. */
  function renderIcon(name, className, title) {
    return TMIcons.render(name, className, title);
  }

  function getSourceMeta(sourceId) {
    return constants.SOURCES[sourceId] || constants.SOURCES.steam;
  }

  function getSteamGameFilterMeta(value) {
    return constants.STEAM_GAME_FILTERS.find((item) => item.value === value) || constants.STEAM_GAME_FILTERS[0];
  }

  function isGameSource(sourceId) {
    return sourceId === 'steam';
  }

  function renderSourceLogo(source, className = '') {
    const classes = ['tm-source-logo', className].filter(Boolean).join(' ');
    return `<img src="${escapeHtml(source.logoUrl || '')}" alt="" class="${classes}" loading="lazy" referrerpolicy="no-referrer">`;
  }

  function getExtensionIconUrl() {
    try {
      return chrome.runtime.getURL('public/tm_importer_128x128.png');
    } catch (err) {
      return '';
    }
  }

  /** Echappe le HTML d'un texte affiche (ex: pseudo venant de Steam/YouTube). */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getCurrentDateString() {
    return new Date().toISOString().slice(0, 10);
  }

  let debounceTimerId = null;

  /** Retarde l'appel de `fn` de `delayMs`, en annulant tout appel en attente. */
  function debounce(fn, delayMs) {
    return (...args) => {
      clearTimeout(debounceTimerId);
      debounceTimerId = setTimeout(() => fn(...args), delayMs);
    };
  }

  /** Annule un appel debounce en attente (utilise pour forcer une recherche immediate). */
  function cancelPendingDebounce() {
    clearTimeout(debounceTimerId);
  }

  global.TMContent = {
    constants,
    state,
    sanitizeFilename,
    formatDate,
    renderIcon,
    getSourceMeta,
    getSteamGameFilterMeta,
    isGameSource,
    renderSourceLogo,
    getExtensionIconUrl,
    escapeHtml,
    getCurrentDateString,
    debounce,
    cancelPendingDebounce
  };
})(typeof window !== 'undefined' ? window : this);

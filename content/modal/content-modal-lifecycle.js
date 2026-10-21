/**
 * content/content-modal-lifecycle.js
 *
 * Ouverture/fermeture de la modale : restauration des reglages enregistres,
 * construction du DOM initial et restauration de l'identite Steam.
 */
(function (global) {
  'use strict';

  const { constants, state } = global.TMContent;
  const { MODAL_ID, SOURCES, LEGACY_IMAGE_TYPE_MAP } = constants;

  function closeModal() {
    const overlay = document.getElementById(MODAL_ID);
    if (overlay) overlay.remove();
  }

  /** Ouvre la modale : restaure les reglages enregistres puis construit le DOM. */
  async function openModal(fileInput) {
    const { renderModalTemplate, renderSourceUI } = global.TMContent;
    const { renderUsersList, bindModalEvents } = global.TMContent;

    if (document.getElementById(MODAL_ID)) return;

    const settings = await TMStorage.getSettings();
    const storedImageType = settings.imageType;
    // Filet de securite si un ancien reglage pointe vers une source retiree depuis.
    state.currentSource = SOURCES[settings.currentSource] ? settings.currentSource : 'steam';
    state.imageType = LEGACY_IMAGE_TYPE_MAP[storedImageType] || storedImageType || 'header';
    state.steamGameFilter = settings.steamGameFilter || '100';
    state.youtubeFilters = {
      fromDate: settings.youtubeFromDate || '',
      toDate: settings.youtubeToDate || '',
      includeLongVideos: settings.youtubeIncludeLongVideos !== false,
      includeShorts: settings.youtubeIncludeShorts !== false
    };
    state.letterboxdFilters = { ...global.TMLetterboxdFilters.DEFAULTS, ...settings.letterboxdFilters };
    state.letterboxdKind = settings.letterboxdKind === 'director' ? 'director' : 'member';
    state.logs = [];
    state.nextLogId = 1;
    state.failedImports = [];
    state.fileInput = fileInput;
    // L'identite Steam (OpenID) est persistee localement : aucun appel reseau
    // necessaire pour l'afficher a l'ouverture.
    state.steamAuth = settings.steamOpenId || { connected: false, steamId: '', personaname: '', avatar: '' };

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'tm-overlay';
    overlay.innerHTML = renderModalTemplate();
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (evt) => {
      if (evt.target === overlay) closeModal();
    });
    overlay.querySelector('.tm-close').addEventListener('click', closeModal);

    await renderSourceUI(overlay);
    bindModalEvents(overlay, fileInput);
    await renderUsersList(overlay);

  }

  Object.assign(global.TMContent, { openModal, closeModal });
})(typeof window !== 'undefined' ? window : this);

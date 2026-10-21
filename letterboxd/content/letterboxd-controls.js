(function (global) {
  'use strict';

  const { state, escapeHtml } = global.TMContent;
  const { DEFAULTS, COLLECTIONS, SORTS } = global.TMLetterboxdFilters;
  const fields = [
    ['collection', 'Catalogue', 'select', COLLECTIONS],
    ['rated', 'Note du compte', 'select', { any: 'Avec ou sans note', yes: 'Notés uniquement', no: 'Sans note uniquement' }],
    ['liked', 'Like du compte', 'select', { any: 'Aimés ou non', yes: 'Aimés uniquement', no: 'Non aimés uniquement' }],
    ['ratingMin', 'Note min. / 5', 'number', 0, 5, 0.5],
    ['ratingMax', 'Note max. / 5', 'number', 0, 5, 0.5],
    ['yearMin', 'Année min.', 'number', 0, 9999, 1],
    ['yearMax', 'Année max.', 'number', 0, 9999, 1],
    ['durationMin', 'Durée min. (minutes)', 'number', 0, 100000, 1],
    ['durationMax', 'Durée max. (minutes)', 'number', 0, 100000, 1],
    ['averageMin', 'Moyenne min. / 5', 'number', 0, 5, 0.01],
    ['averageMax', 'Moyenne max. / 5', 'number', 0, 5, 0.01],
    ['title', 'Titre', 'text'],
    ['genres', 'Genres', 'text', 'Drama, Comedy'],
    ['countries', 'Pays', 'text', 'France, USA'],
    ['languages', 'Langues', 'text', 'French, English'],
    ['director', 'Réalisateur', 'text'],
    ['actor', 'Acteur / actrice', 'text'],
    ['sort', 'Trier par', 'select', SORTS],
    ['limit', 'Limite d’import', 'number', 1, '', 1]
  ];
  const groups = [
    ['Compte', ['collection', 'rated', 'liked', 'ratingMin', 'ratingMax']],
    ['Films', ['title', 'yearMin', 'yearMax', 'durationMin', 'durationMax', 'averageMin', 'averageMax']],
    ['Détails', ['genres', 'countries', 'languages', 'director', 'actor']],
    ['Import', ['sort', 'limit']]
  ];

  function renderLetterboxdControls() {
    const filters = { ...DEFAULTS, ...state.letterboxdFilters };
    const controls = Object.fromEntries(fields.map(([key, label, type, options, max, step]) => {
      const id = `tm-letterboxd-${key}`;
      const value = escapeHtml(String(filters[key]));
      const input = type === 'select'
        ? `<select id="${id}" data-lb-filter="${key}">${Object.entries(options).map(([option, text]) =>
          `<option value="${option}"${filters[key] === option ? ' selected' : ''}>${text}</option>`).join('')}</select>`
        : `<input id="${id}" data-lb-filter="${key}" type="${type}" value="${value}"${type === 'number'
          ? ` min="${options}"${max !== '' ? ` max="${max}"` : ''} step="${step}"`
          : options ? ` placeholder="${options}"` : ''}${key === 'limit' ? ' placeholder="Tous"' : ''}>`;
      return [key, `<div class="tm-field${['collection', 'title', 'genres'].includes(key) ? ' tm-letterboxd-wide' : ''}"><label for="${id}">${label}</label>${input}</div>`];
    }));
    const sections = groups.map(([title, keys]) => `
      <fieldset class="tm-letterboxd-section">
        <legend>${title}</legend>
        <div class="tm-letterboxd-grid">${keys.map((key) => controls[key]).join('')}</div>
        ${title === 'Import' ? `<label class="tm-letterboxd-check"><input type="checkbox" data-lb-filter="descending"${filters.descending ? ' checked' : ''}> Ordre décroissant</label>` : ''}
      </fieldset>`).join('');
    return {
      controlsHtml: `
        <div class="tm-letterboxd-controls">
          <details>
            <summary>Filtres <span class="tm-letterboxd-caret" aria-hidden="true"></span></summary>
            <div class="tm-letterboxd-sections">${sections}</div>
            <div class="tm-letterboxd-footer"><button type="button" class="tm-btn" id="tm-letterboxd-reset">Réinitialiser</button></div>
          </details>
        </div>`,
      searchPanelHtml: `
        <div class="tm-field">
          <label for="tm-letterboxd-kind">À enregistrer</label>
          <select id="tm-letterboxd-kind">
            <option value="member"${state.letterboxdKind !== 'director' ? ' selected' : ''}>Compte Letterboxd</option>
            <option value="director"${state.letterboxdKind === 'director' ? ' selected' : ''}>Réalisateur</option>
          </select>
        </div>
        <div class="tm-field tm-search-field">
          <label for="tm-search-input">Pseudo ou URL Letterboxd</label>
          <input type="text" id="tm-search-input" autocomplete="off" aria-controls="tm-search-results" placeholder="suussonic ou https://letterboxd.com/director/…">
          <div id="tm-search-results" class="tm-search-results" style="display:none"></div>
        </div>
        <button type="button" class="tm-btn" id="tm-letterboxd-add-btn">Enregistrer</button>`
    };
  }

  function bindLetterboxdEvents(overlay) {
    let settingsQueue = Promise.resolve();
    global.TMContent.flushLetterboxdSettings = () => settingsQueue;
    overlay.addEventListener('change', async (event) => {
      const key = event.target.dataset.lbFilter;
      if (!key && event.target.id !== 'tm-letterboxd-kind') return;
      const value = key === 'descending' ? event.target.checked : event.target.value;
      if (event.target.id === 'tm-letterboxd-kind') {
        global.TMContent.cancelPendingDebounce();
        global.TMContent.performSearch(overlay, '');
        overlay.querySelector('#tm-search-input').value = '';
      }
      settingsQueue = settingsQueue.then(async () => {
        if (key && Object.hasOwn(DEFAULTS, key)) {
          const next = { ...state.letterboxdFilters, [key]: value };
          await TMStorage.saveSettings({ letterboxdFilters: next });
          state.letterboxdFilters = next;
        } else if (event.target.id === 'tm-letterboxd-kind') {
          const nextKind = value;
          await TMStorage.saveSettings({ letterboxdKind: nextKind });
          state.letterboxdKind = nextKind;
        }
      }).catch((error) => {
        global.TMContent.showMessage(overlay, error.message, true);
        global.TMContent.logError(overlay, 'settings', error.message);
        if (key) {
          if (key === 'descending') event.target.checked = state.letterboxdFilters.descending;
          else event.target.value = state.letterboxdFilters[key];
        } else {
          event.target.value = state.letterboxdKind;
        }
      });
      await settingsQueue;
    });
    overlay.addEventListener('click', async (event) => {
      if (event.target.closest('#tm-letterboxd-add-btn')) {
        const input = overlay.querySelector('#tm-search-input').value.trim();
        if (!input) {
          global.TMContent.showMessage(overlay, 'Saisissez un pseudo exact ou une URL Letterboxd.', true);
          return;
        }
        await global.TMContent.addUserAndRefreshList(overlay, input, 'letterboxd');
      }
      if (event.target.closest('#tm-letterboxd-reset')) {
        settingsQueue = settingsQueue.then(async () => {
          await TMStorage.saveSettings({ letterboxdFilters: { ...DEFAULTS } });
          state.letterboxdFilters = { ...DEFAULTS };
          await global.TMContent.renderSourceUI(overlay);
        }).catch((error) => {
          global.TMContent.showMessage(overlay, error.message, true);
          global.TMContent.logError(overlay, 'settings', error.message);
        });
        await settingsQueue;
      }
    });
  }

  Object.assign(global.TMContent, { renderLetterboxdControls, bindLetterboxdEvents });
})(typeof window !== 'undefined' ? window : this);

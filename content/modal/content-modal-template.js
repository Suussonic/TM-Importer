/**
 * content/content-modal-template.js
 *
 * Construction du HTML de la modale : squelette general (renderModalTemplate)
 * et contenu specifique a la source active, Steam ou YouTube (renderSourceUI).
 */
(function (global) {
  'use strict';

  const { constants, state, renderIcon, getSourceMeta, renderSourceLogo, escapeHtml, getExtensionIconUrl } = global.TMContent;
  const { SOURCES, STEAM_GAME_FILTERS } = constants;

  function renderModalTemplate() {
    const extensionIconUrl = getExtensionIconUrl();
    return `
      <div class="tm-modal">
        <span class="tm-close" title="Fermer">${renderIcon('close', 'tm-close-icon', 'Fermer')}</span>
        <div class="tm-modal-title">
          ${extensionIconUrl ? `<img src="${escapeHtml(extensionIconUrl)}" alt="" class="tm-modal-title-logo">` : ''}
          <h3>TM Importer</h3>
        </div>
        <div class="tm-source-select-wrap">
          <div class="tm-source-row">
            <div class="tm-source-dropdown">
              <span class="tm-source-label" id="tm-source-caption">Source</span>
              <button type="button" id="tm-source-toggle" class="tm-source-toggle" aria-labelledby="tm-source-caption tm-source-active-label" aria-haspopup="listbox" aria-controls="tm-source-menu" aria-expanded="false">
                <span class="tm-source-toggle-main">
                  <span class="tm-source-badge" id="tm-source-active-badge">${renderSourceLogo(getSourceMeta(state.currentSource))}</span>
                  <span class="tm-source-toggle-text" id="tm-source-active-label">${escapeHtml(getSourceMeta(state.currentSource).label)}</span>
                </span>
                ${renderIcon('chevronDown', 'tm-source-caret', 'Choisir une source')}
              </button>
              <div id="tm-source-menu" class="tm-source-menu" role="listbox" aria-labelledby="tm-source-caption" hidden></div>
            </div>
            <div class="tm-select-group tm-steam-filter-group" id="tm-steam-filter-group" hidden>
              <span class="tm-source-label" id="tm-steam-filter-caption">Jeux</span>
              <button type="button" id="tm-steam-filter-toggle" class="tm-source-toggle" aria-labelledby="tm-steam-filter-caption tm-steam-filter-label" aria-haspopup="listbox" aria-controls="tm-steam-filter-menu" aria-expanded="false">
                <span id="tm-steam-filter-label" class="tm-source-toggle-text">100%</span>
                ${renderIcon('chevronDown', 'tm-source-caret', 'Choisir les jeux')}
              </button>
              <div id="tm-steam-filter-menu" class="tm-source-menu" role="listbox" aria-labelledby="tm-steam-filter-caption" hidden></div>
            </div>
          </div>
        </div>

        <div id="tm-source-controls"></div>

        <div id="tm-message" class="tm-message" style="display:none"></div>

        <button type="button" id="tm-view-logs-btn" class="tm-btn tm-view-logs-btn" style="display:none"></button>

        <div id="tm-progress" class="tm-progress" style="display:none">
          <div class="tm-progress-bar"><div id="tm-progress-fill" class="tm-progress-fill"></div></div>
          <p id="tm-progress-label" class="tm-muted"></p>
        </div>

        <div id="tm-failed-games" class="tm-failed-panel" style="display:none">
          <div class="tm-failed-panel-header">
            <div>
              <div class="tm-failed-panel-title">Imports à relancer</div>
              <p class="tm-failed-panel-subtitle">Certaines images n'ont pas pu être récupérées. Vous pouvez relancer chaque élément individuellement ou tout relancer d'un coup.</p>
            </div>
            <button type="button" id="tm-retry-all-failed-btn" class="tm-icon-btn tm-failed-retry-all" title="Relancer tous les imports échoués">${renderIcon('reload', 'tm-btn-icon', 'Relancer tous les imports échoués')}</button>
          </div>
          <div id="tm-failed-games-list" class="tm-failed-games-list"></div>
        </div>

        <div id="tm-users-list" class="tm-users-list"></div>

        <button type="button" id="tm-add-user-toggle" class="tm-btn tm-btn-add-user"></button>

        <div id="tm-add-user-panel" class="tm-add-user-panel" style="display:none">
          <div id="tm-add-user-panel-content"></div>
        </div>
      </div>
    `;
  }

  /** Rend les controles specifiques a Steam (connexion OpenID + type d'image) et le panneau de recherche. */
  function renderSteamControls(showSteamExtras) {
    const steamAuth = state.steamAuth;
    const steamAuthLabel = steamAuth.connected
      ? `Connecte en tant que ${steamAuth.personaname ? escapeHtml(steamAuth.personaname) : 'utilisateur'} via Steam OpenID`
      : 'Connexion Steam requise pour charger jeux et succes';
    const steamAuthHint = steamAuth.connected
      ? 'La recherche et le rechargement des bibliotheques Steam sont disponibles.'
      : 'Authentification officielle via le Steam OpenID Provider (steamcommunity.com/dev)';

    const controlsHtml = `
      ${steamAuth.connected ? `
      <div class="tm-steam-auth-card is-connected">
        <div class="tm-steam-auth-copy">
          <span class="tm-steam-auth-status">${steamAuthLabel}</span>
        </div>
        <div class="tm-steam-auth-actions">
          <button type="button" id="tm-steam-auth-btn" class="tm-btn tm-steam-auth-btn">Se deconnecter</button>
        </div>
      </div>
      ` : `
      <button type="button" id="tm-steam-auth-btn" class="tm-steam-auth-signin-btn" title="${escapeHtml(steamAuthHint)}">
        <img src="${chrome.runtime.getURL('public/Steam OpenID.png')}" alt="${steamAuthLabel}">
      </button>
      `}

      ${showSteamExtras ? `
      <div class="tm-field">
        <label for="tm-image-type">Type d'image a importer</label>
        <select id="tm-image-type">
          <option value="header">Header (boutique)</option>
          <option value="capsule">Capsule bibliotheque (verticale)</option>
          <option value="hero">Hero (banniere bibliotheque)</option>
          <option value="hero_blur">Hero floute</option>
          <option value="logo">Logo</option>
          <option value="icon">Icone</option>
        </select>
      </div>
      ` : ''}
    `;

    const searchPanelHtml = `
      <div class="tm-field tm-search-field">
        <label for="tm-search-input">Rechercher un utilisateur (pseudo ou SteamID64)</label>
        <input type="text" id="tm-search-input" autocomplete="off" placeholder="Ex: gaben ou 76561197960287930">
        <div id="tm-search-results" class="tm-search-results" style="display:none"></div>
      </div>
    `;

    return { controlsHtml, searchPanelHtml };
  }

  /** Reconstruit entierement les controles (source, filtres, ajout) selon la source active. */
  async function renderSourceUI(overlay) {
    const controls = overlay.querySelector('#tm-source-controls');
    const sourceMenu = overlay.querySelector('#tm-source-menu');
    const sourceBadge = overlay.querySelector('#tm-source-active-badge');
    const sourceLabel = overlay.querySelector('#tm-source-active-label');
    const sourceToggle = overlay.querySelector('#tm-source-toggle');
    const steamFilterGroup = overlay.querySelector('#tm-steam-filter-group');
    const steamFilterMenu = overlay.querySelector('#tm-steam-filter-menu');
    const addUserToggle = overlay.querySelector('#tm-add-user-toggle');
    const addUserPanel = overlay.querySelector('#tm-add-user-panel');
    const addUserPanelContent = overlay.querySelector('#tm-add-user-panel-content');

    const selectedSource = getSourceMeta(state.currentSource);
    sourceBadge.innerHTML = renderSourceLogo(selectedSource);
    sourceLabel.textContent = selectedSource.label;
    sourceToggle.setAttribute('aria-expanded', 'false');
    sourceMenu.hidden = true;
    sourceMenu.innerHTML = Object.values(SOURCES)
      .map((source) => `
        <button type="button" role="option" tabindex="-1" aria-selected="${source.id === state.currentSource}" class="tm-source-option" data-source-id="${source.id}">
          <span class="tm-source-badge">${renderSourceLogo(source)}</span>
          <span class="tm-source-option-text">${escapeHtml(source.label)}</span>
          ${renderIcon('check', 'tm-dropdown-check', 'Selectionne')}
        </button>
      `)
      .join('');

    // Sans connexion Steam ni compte deja enregistre localement, il n'y a rien
    // a filtrer/importer/ajouter : ces controles sont masques plutot que
    // laisses inutilisables au-dessus du bouton de connexion.
    const hasLocalSteamUsers = Object.keys(await TMStorage.getUsers()).length > 0;
    const showSteamExtras = state.currentSource !== 'steam' || state.steamAuth.connected || hasLocalSteamUsers;

    const showSteamFilter = state.currentSource === 'steam' && showSteamExtras;
    steamFilterGroup.hidden = !showSteamFilter;
    steamFilterGroup.style.display = showSteamFilter ? '' : 'none';
    overlay.querySelector('#tm-steam-filter-toggle').setAttribute('aria-expanded', 'false');
    steamFilterMenu.hidden = true;
    overlay.querySelector('#tm-steam-filter-label').textContent =
      global.TMContent.getSteamGameFilterMeta(state.steamGameFilter).label;
    const descriptions = { '100': 'Tous les succes debloques', owned: 'Toute la bibliotheque', played: 'Avec du temps de jeu' };
    steamFilterMenu.innerHTML = STEAM_GAME_FILTERS.map((item) => `
      <button type="button" role="option" tabindex="-1" aria-selected="${item.value === state.steamGameFilter}" class="tm-source-option" data-filter-value="${item.value}">
        <span class="tm-dropdown-option-copy">
          <span class="tm-source-option-text">${escapeHtml(item.label)}</span>
          <span class="tm-dropdown-description">${descriptions[item.value]}</span>
        </span>
        ${renderIcon('check', 'tm-dropdown-check', 'Selectionne')}
      </button>
    `).join('');

    const showAddUserToggle = state.currentSource !== 'steam' || showSteamExtras;
    addUserToggle.hidden = !showAddUserToggle;
    addUserToggle.style.display = showAddUserToggle ? '' : 'none';
    if (!showAddUserToggle && addUserPanel) addUserPanel.style.display = 'none';

    addUserToggle.textContent = state.currentSource === 'steam'
      ? '+ Ajouter un nouvel utilisateur'
      : state.currentSource === 'letterboxd' ? '+ Ajouter un compte ou réalisateur' : '+ Ajouter une chaine ou playlist';

    if (state.currentSource === 'letterboxd') {
      const { controlsHtml, searchPanelHtml } = global.TMContent.renderLetterboxdControls();
      controls.innerHTML = controlsHtml;
      addUserPanelContent.innerHTML = searchPanelHtml;
      return;
    }

    if (state.currentSource === 'steam') {
      const { controlsHtml, searchPanelHtml } = renderSteamControls(showSteamExtras);
      controls.innerHTML = controlsHtml;
      addUserPanelContent.innerHTML = searchPanelHtml;
      const imageTypeSelect = overlay.querySelector('#tm-image-type');
      if (imageTypeSelect) imageTypeSelect.value = state.imageType;
      return;
    }

    // Delegue a content-modal-template-youtube.js (charge avant ce fichier).
    const { controlsHtml, searchPanelHtml } = global.TMContent.renderYouTubeControls();
    controls.innerHTML = controlsHtml;
    addUserPanelContent.innerHTML = searchPanelHtml;
    overlay.querySelector('#tm-youtube-from-date').value = state.youtubeFilters.fromDate;
    overlay.querySelector('#tm-youtube-to-date').value = state.youtubeFilters.toDate;
    overlay.querySelector('#tm-youtube-include-long').checked = state.youtubeFilters.includeLongVideos;
    overlay.querySelector('#tm-youtube-include-shorts').checked = state.youtubeFilters.includeShorts;
  }

  Object.assign(global.TMContent, { renderModalTemplate, renderSourceUI });
})(typeof window !== 'undefined' ? window : this);

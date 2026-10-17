/**
 * content/content-search.js
 *
 * Recherche d'un compte Steam ou d'une chaine YouTube pendant la saisie, et
 * ajout du resultat choisi (ou saisi directement) a la liste des comptes
 * enregistres.
 */
(function (global) {
  'use strict';

  const { state, constants, escapeHtml, debounce } = global.TMContent;

  /** Affiche une liste de resultats cliquables sous le champ de recherche. */
  function renderSearchResults(overlay, items, onPick) {
    const container = overlay.querySelector('#tm-search-results');
    container.innerHTML = '';

    if (!items || items.length === 0) {
      const emptyMessage = state.currentSource === 'steam'
        ? 'Aucun resultat. Essayez avec le SteamID64 exact.'
        : 'Aucune chaine trouvee. Essayez un nom plus precis ou collez une URL YouTube.';
      container.innerHTML = `<div class="tm-search-empty">${emptyMessage}</div>`;
      container.style.display = 'block';
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'tm-search-item';
      row.innerHTML = `
        ${item.avatar ? `<img src="${escapeHtml(item.avatar)}" alt="">` : '<span class="tm-search-avatar-placeholder"></span>'}
        <span>${escapeHtml(item.name)}</span>
      `;
      row.addEventListener('click', () => onPick(item));
      container.appendChild(row);
    });
    container.style.display = 'block';
  }

  /** Resout un profil (Steam ou YouTube), l'enregistre puis rafraichit la liste des comptes. */
  async function addUserAndRefreshList(overlay, inputValue, source = state.currentSource) {
    const { showMessage, setButtonsBusy, hideSearchResults } = global.TMContent;
    const { logError, renderUsersList } = global.TMContent;

    showMessage(overlay, source === 'steam' ? 'Verification du profil...' : 'Verification de la source YouTube...', false);
    setButtonsBusy(overlay, true);

    try {
      if (source === 'youtube') {
        const profile = await TMYouTubeClient.resolveInput(inputValue);
        await TMStorage.saveYouTubeUser(profile.id, profile);
        setButtonsBusy(overlay, false);
        hideSearchResults(overlay);
        const searchInput = overlay.querySelector('#tm-search-input');
        if (searchInput) searchInput.value = '';
        overlay.querySelector('#tm-add-user-panel').style.display = 'none';
        showMessage(overlay, `Source YouTube "${profile.title}" ajoutee.`, false);
        await renderUsersList(overlay);
        return;
      }

      const profile = await TMSteamClient.resolveProfile(inputValue);
      await TMStorage.saveUser(profile.steamId, { personaname: profile.personaname, avatar: profile.avatar });

      setButtonsBusy(overlay, false);
      hideSearchResults(overlay);
      overlay.querySelector('#tm-search-input').value = '';
      overlay.querySelector('#tm-add-user-panel').style.display = 'none';
      showMessage(overlay, `Compte "${profile.personaname}" ajouté.`, false);
      await renderUsersList(overlay);
    } catch (err) {
      setButtonsBusy(overlay, false);
      showMessage(overlay, err.message || String(err), true);
      logError(overlay, 'add-user', err.message || String(err));
    }
  }

  /** Recherche Steam : un SteamID64 saisi directement est resolu immediatement plutot que recherche par pseudo. */
  async function searchSteamUsers(overlay, query) {
    const { showMessage, logError } = global.TMContent;

    if (/^\d{17}$/.test(query)) {
      try {
        const profile = await TMSteamClient.resolveProfile(query);
        renderSearchResults(overlay, [{ id: profile.steamId, name: profile.personaname, avatar: profile.avatar }], (item) =>
          addUserAndRefreshList(overlay, item.id)
        );
      } catch (err) {
        renderSearchResults(overlay, [], null);
      }
      return;
    }

    try {
      const results = await TMSteamClient.searchUsers(query);
      renderSearchResults(overlay, results, (item) => addUserAndRefreshList(overlay, item.id));
    } catch (err) {
      // Repli : l'AJAX de recherche par pseudo de Steam bloque parfois les
      // requetes automatisees (401) meme pour un profil public. Si la saisie
      // est exactement l'URL personnalisee du profil, la page de profil
      // (?xml=1) la resout directement sans passer par cet AJAX.
      try {
        const profile = await TMSteamClient.resolveProfile(query);
        renderSearchResults(overlay, [{ id: profile.steamId, name: profile.personaname, avatar: profile.avatar }], (item) =>
          addUserAndRefreshList(overlay, item.id)
        );
      } catch (fallbackErr) {
        showMessage(overlay, err.message || String(err), true);
        logError(overlay, 'search', err.message || String(err));
      }
    }
  }

  async function searchYouTubeChannels(overlay, query, isCurrent) {
    const { showMessage, hideSearchResults, logError } = global.TMContent;

    try {
      const directInput = /^(?:https?:\/\/|@|UC[\w-]{22}$|(?:PL|UU|FL|OL)[\w-]{16,}$)/i.test(query);
      const results = directInput
        ? [await TMYouTubeClient.resolveInput(query)]
        : await TMYouTubeClient.searchChannels(query);
      if (!isCurrent()) return;
      renderSearchResults(overlay, results.map((item) => ({ ...item, name: item.title })), (item) =>
        addUserAndRefreshList(overlay, item.canonicalUrl || item.id, 'youtube')
      );
    } catch (err) {
      if (!isCurrent()) return;
      hideSearchResults(overlay);
      showMessage(overlay, err.message || String(err), true);
      logError(overlay, 'search', err.message || String(err));
    }
  }

  let searchVersion = 0;

  const debouncedSearch = debounce(async (overlay, query, source, version) => {
    const isCurrent = () => version === searchVersion && state.currentSource === source && overlay.isConnected;
    if (!isCurrent()) return;
    if (source === 'youtube') {
      global.TMContent.showMessage(overlay, '', false);
      const container = overlay.querySelector('#tm-search-results');
      container.innerHTML = '<div class="tm-search-empty" role="status">Recherche...</div>';
      container.style.display = 'block';
      await searchYouTubeChannels(overlay, query, isCurrent);
      return;
    }
    await searchSteamUsers(overlay, query);
  }, constants.SEARCH_DEBOUNCE_MS);

  /** Invalide immediatement les anciennes requetes, puis attend la fin de saisie. */
  function performSearch(overlay, query) {
    const { hideSearchResults } = global.TMContent;
    const version = ++searchVersion;
    hideSearchResults(overlay);
    if (query.length < constants.MIN_SEARCH_LENGTH) {
      return;
    }
    debouncedSearch(overlay, query, state.currentSource, version);
  }

  Object.assign(global.TMContent, { renderSearchResults, addUserAndRefreshList, performSearch });
})(typeof window !== 'undefined' ? window : this);

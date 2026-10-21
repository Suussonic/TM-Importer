/**
 * content/content-events.js
 *
 * Liaison de tous les evenements DOM de la modale une fois son contenu
 * construit (changement de source, connexion Steam, recherche,
 * actions par ligne de compte, positionnement du menu de source, etc).
 */
(function (global) {
  'use strict';

  const { state } = global.TMContent;

  /** Change la source active (Steam/YouTube) et reconstruit la modale en consequence. */
  async function switchSource(overlay, nextSource) {
    const { renderSourceUI, renderUsersList, hideSearchResults, showFailedGames, showMessage } = global.TMContent;
    const { updateYouTubeDateBounds } = global.TMContent;

    if (nextSource === state.currentSource) return;
    await global.TMContent.flushLetterboxdSettings?.();
    await TMStorage.saveSettings({ currentSource: nextSource });
    state.currentSource = nextSource;
    state.failedImports = [];
    await renderSourceUI(overlay);
    hideSearchResults(overlay);
    showFailedGames(overlay, null);
    showMessage(overlay, '', false);
    await renderUsersList(overlay);

    if (state.currentSource === 'youtube') {
      const youtubeUsers = await TMStorage.getYouTubeUsers();
      const firstProfileId = Object.keys(youtubeUsers)[0] || '';
      updateYouTubeDateBounds(overlay, firstProfileId ? await TMStorage.getYouTubeItemsForUser(firstProfileId) : null);
    }
  }

  function bindSourceMenuEvents(overlay) {
    const pairs = ['tm-source', 'tm-steam-filter'].map((id) => ({
      toggle: overlay.querySelector(`#${id}-toggle`),
      menu: overlay.querySelector(`#${id}-menu`)
    }));
    function close(pair, focus = false) {
      pair.menu.hidden = true;
      pair.toggle.setAttribute('aria-expanded', 'false');
      if (focus) pair.toggle.focus();
    }
    function position(pair) {
      const rect = pair.toggle.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 210), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const upward = below < Math.min(pair.menu.scrollHeight, 210) && above > below;
      const available = Math.max(0, upward ? above : below);
      pair.menu.style.width = `${width}px`;
      pair.menu.style.maxHeight = `${available}px`;
      pair.menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      pair.menu.style.top = `${upward ? Math.max(12, rect.top - Math.min(pair.menu.scrollHeight, available) - 6) : rect.bottom + 6}px`;
    }
    function open(pair, last = false) {
      pairs.forEach((other) => close(other));
      pair.menu.hidden = false;
      pair.toggle.setAttribute('aria-expanded', 'true');
      position(pair);
      const options = [...pair.menu.querySelectorAll('[role="option"]')];
      const selected = options.find((option) => option.getAttribute('aria-selected') === 'true');
      (last ? options[options.length - 1] : selected || options[0])?.focus();
    }
    for (const pair of pairs) {
      pair.toggle.addEventListener('click', () => {
        if (pair.menu.hidden) open(pair);
        else close(pair, true);
      });
      pair.toggle.addEventListener('keydown', (evt) => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(evt.key)) {
          evt.preventDefault();
          open(pair, evt.key === 'ArrowUp' || evt.key === 'End');
          if (evt.key === 'Home') pair.menu.querySelector('[role="option"]')?.focus();
        }
      });
      pair.menu.addEventListener('keydown', (evt) => {
        const options = [...pair.menu.querySelectorAll('[role="option"]')];
        const index = options.indexOf(document.activeElement);
        if (evt.key === 'Escape') {
          evt.preventDefault();
          close(pair, true);
        } else if (evt.key === 'Tab') {
          close(pair, true);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(evt.key)) {
          evt.preventDefault();
          const next = evt.key === 'Home' ? 0 : evt.key === 'End' ? options.length - 1 :
            (index + (evt.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
          options[next]?.focus();
        }
      });
      pair.menu.addEventListener('click', async (evt) => {
        const option = evt.target.closest('[role="option"]');
        if (!option || option.disabled) return;
        close(pair, true);
        try {
          if (option.dataset.sourceId) {
            await switchSource(overlay, option.dataset.sourceId);
          } else {
            state.steamGameFilter = option.dataset.filterValue;
            await TMStorage.saveSettings({ steamGameFilter: state.steamGameFilter });
            overlay.querySelector('#tm-steam-filter-label').textContent = option.querySelector('.tm-source-option-text').textContent;
            pair.menu.querySelectorAll('[role="option"]').forEach((item) =>
              item.setAttribute('aria-selected', String(item === option)));
          }
        } catch (error) {
          global.TMContent.showMessage(overlay, error.message || String(error), true);
          global.TMContent.logError(overlay, 'settings', error.message || String(error));
        }
      });
    }
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener('pointerdown', (evt) => {
      for (const pair of pairs) {
        if (!pair.menu.contains(evt.target) && !pair.toggle.contains(evt.target)) close(pair);
      }
    }, { signal });
    document.addEventListener('focusin', (evt) => {
      for (const pair of pairs) {
        if (!pair.menu.contains(evt.target) && !pair.toggle.contains(evt.target)) close(pair);
      }
    }, { signal });
    const reposition = () => pairs.forEach((pair) => {
      if (!pair.menu.hidden) position(pair);
    });
    window.addEventListener('resize', reposition, { signal });
    window.addEventListener('scroll', reposition, { capture: true, signal });
    const observer = new MutationObserver(() => {
      if (!overlay.isConnected) {
        controller.abort();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  }

  function bindGlobalFormEvents(overlay) {
    const { performSearch } = global.TMContent;

    overlay.addEventListener('input', async (evt) => {
      try {
        if (evt.target.id === 'tm-search-input') {
          performSearch(overlay, evt.target.value.trim());
        }
        if (evt.target.id === 'tm-youtube-from-date' || evt.target.id === 'tm-youtube-to-date') {
          state.youtubeFilters.fromDate = overlay.querySelector('#tm-youtube-from-date').value;
          state.youtubeFilters.toDate = overlay.querySelector('#tm-youtube-to-date').value;
          await TMStorage.saveSettings({
            youtubeFromDate: state.youtubeFilters.fromDate,
            youtubeToDate: state.youtubeFilters.toDate
          });
        }
      } catch (error) {
        global.TMContent.showMessage(overlay, error.message || String(error), true);
        global.TMContent.logError(overlay, 'settings', error.message || String(error));
      }
    });

    overlay.addEventListener('change', async (evt) => {
      try {
        if (evt.target.id === 'tm-image-type') {
          state.imageType = evt.target.value;
          await TMStorage.saveSettings({ imageType: state.imageType });
        }
        if (evt.target.id === 'tm-youtube-include-long' || evt.target.id === 'tm-youtube-include-shorts') {
          state.youtubeFilters.includeLongVideos = overlay.querySelector('#tm-youtube-include-long').checked;
          state.youtubeFilters.includeShorts = overlay.querySelector('#tm-youtube-include-shorts').checked;
          await TMStorage.saveSettings({
            youtubeIncludeLongVideos: state.youtubeFilters.includeLongVideos,
            youtubeIncludeShorts: state.youtubeFilters.includeShorts
          });
        }
      } catch (error) {
        global.TMContent.showMessage(overlay, error.message || String(error), true);
        global.TMContent.logError(overlay, 'settings', error.message || String(error));
      }
    });

    overlay.addEventListener('keydown', (evt) => {
      if (evt.target.id === 'tm-search-input' && evt.key === 'Enter') {
        evt.preventDefault();
        performSearch(overlay, evt.target.value.trim());
      }
    });

    document.addEventListener('click', (evt) => {
      const { hideSearchResults } = global.TMContent;
      const searchInput = overlay.querySelector('#tm-search-input');
      const searchResults = overlay.querySelector('#tm-search-results');
      if (!searchInput || !searchResults) return;
      if (!searchResults.contains(evt.target) && evt.target !== searchInput) {
        hideSearchResults(overlay);
      }
    });
  }

  /** Connexion Steam et ajout YouTube : voir content-events-actions.js. */
  /** Actions par ligne de compte (recharger/importer/supprimer) : voir content-events-actions.js. */

  /** Relie tous les evenements de la modale une fois son contenu initial construit. */
  function bindModalEvents(overlay, fileInput) {
    const { openLogsModal, getFailedImportKey, retryImportFailures, bindAuthButtonEvents, bindUserRowActions } = global.TMContent;

    const addUserToggle = overlay.querySelector('#tm-add-user-toggle');
    const addUserPanel = overlay.querySelector('#tm-add-user-panel');
    const retryAllFailedBtn = overlay.querySelector('#tm-retry-all-failed-btn');

    addUserToggle.addEventListener('click', () => {
      addUserPanel.style.display = addUserPanel.style.display === 'none' ? 'block' : 'none';
    });

    overlay.querySelector('#tm-view-logs-btn').addEventListener('click', () => openLogsModal());

    retryAllFailedBtn.addEventListener('click', async () => {
      await retryImportFailures(overlay, state.failedImports, 'sidebar');
    });

    overlay.querySelector('#tm-failed-games-list').addEventListener('click', async (evt) => {
      const retryBtn = evt.target.closest('.tm-retry-failed-game-btn');
      if (!retryBtn) return;
      const failedKey = retryBtn.dataset.failedKey;
      const failedItem = state.failedImports.find((item) => getFailedImportKey(item) === failedKey);
      if (!failedItem) return;
      await retryImportFailures(overlay, [failedItem], 'sidebar');
    });

    bindSourceMenuEvents(overlay);
    bindGlobalFormEvents(overlay);
    global.TMContent.bindLetterboxdEvents(overlay);
    bindAuthButtonEvents(overlay);
    bindUserRowActions(overlay, fileInput);
  }

  Object.assign(global.TMContent, { bindModalEvents });
})(typeof window !== 'undefined' ? window : this);

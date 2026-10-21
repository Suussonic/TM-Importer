/**
 * content/content-reload.js
 *
 * Rechargement des donnees d'un compte : scan des jeux Steam a 100% (ou de
 * la bibliotheque complete) et rafraichissement du catalogue de videos
 * YouTube d'une chaine/playlist.
 */
(function (global) {
  'use strict';

  const { state, getCurrentDateString } = global.TMContent;

  function getYouTubeFilterPayload() {
    return {
      fromDate: state.youtubeFilters.fromDate,
      toDate: state.youtubeFilters.toDate,
      includeLongVideos: state.youtubeFilters.includeLongVideos,
      includeShorts: state.youtubeFilters.includeShorts
    };
  }

  /** Ajuste les bornes min/max des champs de date YouTube selon le catalogue en cache. */
  function updateYouTubeDateBounds(overlay, cachedData) {
    if (state.currentSource !== 'youtube') return;
    const fromInput = overlay.querySelector('#tm-youtube-from-date');
    const toInput = overlay.querySelector('#tm-youtube-to-date');
    if (!fromInput || !toInput) return;

    const maxDate = getCurrentDateString();
    fromInput.max = maxDate;
    toInput.max = maxDate;

    const minDate = cachedData && cachedData.firstPublishedAt ? cachedData.firstPublishedAt : '';
    if (minDate) {
      fromInput.min = minDate;
      toInput.min = minDate;
    } else {
      fromInput.removeAttribute('min');
      toInput.removeAttribute('min');
    }

    if (fromInput.value && fromInput.min && fromInput.value < fromInput.min) {
      fromInput.value = fromInput.min;
      state.youtubeFilters.fromDate = fromInput.value;
    }
    if (toInput.value && toInput.min && toInput.value < toInput.min) {
      toInput.value = toInput.min;
      state.youtubeFilters.toDate = toInput.value;
    }
    if (fromInput.value && fromInput.value > maxDate) {
      fromInput.value = maxDate;
      state.youtubeFilters.fromDate = fromInput.value;
    }
    if (toInput.value && toInput.value > maxDate) {
      toInput.value = maxDate;
      state.youtubeFilters.toDate = toInput.value;
    }
  }

  /** Recharge le catalogue de videos YouTube d'une chaine/playlist enregistree. */
  async function handleReloadYouTube(overlay, profileId, username) {
    const { showMessage, showFailedGames, setButtonsBusy, setProgress, logError, renderUsersList } = global.TMContent;

    const profiles = await TMStorage.getYouTubeUsers();
    const profile = profiles[profileId];
    if (!profile) {
      throw new Error('Source YouTube introuvable.');
    }

    showMessage(overlay, '', false);
    showFailedGames(overlay, null);
    setButtonsBusy(overlay, true);
    setProgress(overlay, 0, 1, `Analyse des videos de ${username}...`);

    try {
      const catalog = await TMYouTubeClient.reloadCatalog(profile, {
        onProgress: (current) =>
          setProgress(overlay, 0, 1, `Lecture des pages YouTube de ${username} : ${current} video(s) trouvee(s)...`)
      });

      const cachedData = {
        items: catalog.items,
        totalItems: catalog.totalItems,
        firstPublishedAt: catalog.firstPublishedAt,
        lastPublishedAt: catalog.lastPublishedAt,
        scraped: catalog.scraped,
        lastFetched: Date.now()
      };
      await TMStorage.saveYouTubeItemsForUser(profileId, cachedData);

      state.logs = state.logs.filter((entry) =>
        !entry.retryReload || entry.retryReload.source !== 'youtube' || entry.retryReload.profileId !== profileId);
      global.TMContent.updateLogsButton(overlay);
      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      updateYouTubeDateBounds(overlay, cachedData);
      await renderUsersList(overlay);
      showMessage(overlay, `Catalogue YouTube de "${username}" mis a jour avec succes.`, false);
    } catch (err) {
      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      showMessage(overlay, err.message || String(err), true);
      logError(overlay, 'reload', `${username}: ${err.message || err}`, {
        retryReload: { source: 'youtube', profileId, username }
      });
    }
  }

  /** Relance un scan complet des jeux Steam (ou delegue a YouTube) pour un compte donne. */
  async function handleReload(overlay, profileId, username) {
    const { showMessage, showFailedGames, setButtonsBusy, setProgress, logError, renderUsersList } = global.TMContent;

    if (state.currentSource === 'letterboxd') {
      return global.TMContent.handleReloadLetterboxd(overlay, profileId, username);
    }
    if (state.currentSource === 'youtube') {
      return handleReloadYouTube(overlay, profileId, username);
    }
    if (!state.steamAuth.connected) {
      showMessage(overlay, 'Connectez-vous avec Steam (carte en haut de la fenetre) pour charger la liste de jeux.', true);
      return;
    }
    showMessage(overlay, '', false);
    showFailedGames(overlay, null);
    setButtonsBusy(overlay, true);
    setProgress(overlay, 0, 1, `Récupération de la liste de jeux de ${username}...`);

    const filterMode = state.steamGameFilter;
    const progressVerb = filterMode === '100' ? 'Analyse des succès' : 'Analyse de la bibliotheque';

    try {
      const scanResult = await TMSteamClient.scanCompletedGames(profileId, {
        filterMode,
        onProgress: (current, total) =>
          setProgress(overlay, current, total, `${progressVerb} de ${username} : ${current}/${total}...`)
      });

      const gamesData = {
        completed: scanResult.completed,
        totalOwned: scanResult.totalOwned,
        failed: scanResult.failed,
        failedCount: scanResult.failed.length,
        filterMode,
        lastFetched: Date.now()
      };
      await TMStorage.saveGamesForUser(profileId, gamesData);

      // Diagnostic pour comparer avec la page Steam ("Jeux termines a 100%") :
      // la console du navigateur (F12) liste les jeux detectes par nom.
      console.log(
        `[TM Importer] ${username} : ${scanResult.completed.length}/${scanResult.totalOwned} jeu(x) a 100% detecte(s) (mode ${filterMode}).`,
        scanResult.completed.map((game) => game.name).sort()
      );

      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      await renderUsersList(overlay);

      if (scanResult.failed.length > 0) {
        scanResult.failed.forEach((game) => {
          const gameRef = game.appid || game.gameId || game.id || '?';
          logError(overlay, 'reload', `${game.name} (id ${gameRef}) : ${game.message}`);
        });
        showMessage(
          overlay,
          `Données de "${username}" mises à jour, mais ${scanResult.failed.length} jeu(x) n'ont pas pu être vérifié(s) (voir les logs).`,
          true
        );
      } else {
        showMessage(overlay, `Données de "${username}" mises à jour avec succès.`, false);
      }
    } catch (err) {
      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      showMessage(overlay, err.message || String(err), true);
      logError(overlay, 'reload', `${username}: ${err.message || err}`);
    }
  }

  Object.assign(global.TMContent, { getYouTubeFilterPayload, updateYouTubeDateBounds, handleReloadYouTube, handleReload });
})(typeof window !== 'undefined' ? window : this);

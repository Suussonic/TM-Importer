/**
 * content/content-import.js
 *
 * Telechargement des jaquettes/miniatures (cache local puis reseau) et
 * injection dans le champ d'upload natif de TierMaker, pour un import
 * initial ou pour la relance des imports precedemment en echec.
 */
(function (global) {
  'use strict';

  const { state, sanitizeFilename } = global.TMContent;

  /** Recupere (cache local puis, sinon, reseau) l'image d'un jeu/video sous forme de Blob. */
  async function getImageBlob(item, imageType, source) {
    const effectiveSource = source || state.currentSource;

    if (effectiveSource === 'letterboxd') {
      let dataUrl = await TMStorage.getSourceImage('letterboxd', item.id, 'poster-hd');
      if (!dataUrl) {
        dataUrl = await TMLetterboxdClient.fetchPoster(item);
        await TMStorage.saveSourceImage('letterboxd', item.id, 'poster-hd', dataUrl);
      }
      global.TMContent.registerLetterboxdPoster(dataUrl);
      return (await fetch(dataUrl)).blob();
    }

    if (effectiveSource === 'youtube') {
      const videoId = item.videoId || item.id;
      let dataUrl = await TMStorage.getSourceImage('youtube', videoId, 'thumbnail');
      if (!dataUrl) {
        dataUrl = await TMYouTubeClient.fetchThumbnail(item.thumbnailUrl, videoId);
        await TMStorage.saveSourceImage('youtube', videoId, 'thumbnail', dataUrl);
      }
      const response = await fetch(dataUrl);
      return response.blob();
    }

    const gameId = item.appid || item.gameId || item.id;
    if (!gameId) {
      throw new Error('Identifiant de jeu manquant.');
    }

    let dataUrl = await TMStorage.getSourceImage(effectiveSource, gameId, imageType);
    if (!dataUrl) {
      dataUrl = await TMSteamClient.fetchGameImage(gameId, imageType, item.iconUrl);
      await TMStorage.saveSourceImage(effectiveSource, gameId, imageType, dataUrl);
    }

    const response = await fetch(dataUrl);
    return response.blob();
  }

  /**
   * Telecharge (ou recupere du cache) les jaquettes/miniatures des elements
   * fournis puis les injecte dans le champ d'upload natif de TierMaker en
   * reutilisant son propre mecanisme (evenement `change`). Retourne la liste
   * des elements dont l'image n'a pas pu etre recuperee.
   */
  async function importItemsAsImages(fileInput, items, imageType, onProgress, appendToExistingFiles = false, source = null) {
    const dataTransfer = new DataTransfer();
    const failedItems = [];
    let importedCount = 0;
    const effectiveSource = source || state.currentSource;

    if (appendToExistingFiles) {
      Array.from(fileInput.files || []).forEach((file) => dataTransfer.items.add(file));
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const effectiveImageType = item.imageType || imageType;
      try {
        const blob = await getImageBlob(item, effectiveImageType, effectiveSource);
        const suffix = effectiveSource === 'youtube' ? 'thumbnail' : effectiveImageType;
        const file = new File([blob], `${sanitizeFilename(item.name || item.title)}_${suffix}.jpg`, {
          type: blob.type || 'image/jpeg'
        });
        dataTransfer.items.add(file);
        importedCount++;
      } catch (err) {
        failedItems.push({ ...item, imageType: effectiveImageType, error: err.message || String(err) });
        console.warn('[TM Importer] Image indisponible pour', item.name, err);
      }
      if (onProgress) onProgress(i + 1, items.length);
    }

    if (importedCount === 0) {
      const error = new Error("Aucune image n'a pu être récupérée.");
      error.failedItems = failedItems;
      throw error;
    }

    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    return { imported: importedCount, failedItems };
  }

  /** Importe les miniatures YouTube (filtrees selon les reglages courants) d'une chaine/playlist. */
  async function handleImportYouTube(overlay, fileInput, profileId, username) {
    const { showMessage, showFailedGames, setButtonsBusy, setProgress, logError } = global.TMContent;
    const { getYouTubeFilterPayload, updateYouTubeDateBounds } = global.TMContent;

    const cachedData = await TMStorage.getYouTubeItemsForUser(profileId);
    if (!cachedData || !cachedData.items || cachedData.items.length === 0) {
      showMessage(overlay, `Aucune miniature YouTube en cache pour "${username}". Cliquez sur "Recharger" d'abord.`, true);
      return;
    }

    updateYouTubeDateBounds(overlay, cachedData);
    showMessage(overlay, '', false);
    showFailedGames(overlay, null);
    setButtonsBusy(overlay, true);
    try {
      const filters = getYouTubeFilterPayload();
      if (!filters.includeLongVideos && !filters.includeShorts) {
        throw new Error('Selectionnez au moins un type : Videos ou Shorts.');
      }
      const items = await TMYouTubeClient.prepareItems(cachedData.items, filters, (current, total) => {
        setProgress(overlay, current, total, `Lecture des dates YouTube : ${current}/${total}...`);
      });
      if (filters.fromDate || filters.toDate) {
        await TMStorage.saveYouTubeItemsForUser(profileId, { ...cachedData, items });
      }
      const filteredItems = TMYouTubeClient.filterItems(items, filters);
      if (filteredItems.length === 0) {
        throw new Error(`Aucune video YouTube ne correspond aux filtres selectionnes pour "${username}".`);
      }
      const result = await importItemsAsImages(fileInput, filteredItems, 'thumbnail', (current, total) => {
        setProgress(overlay, current, total, `Telechargement des miniatures de ${username} : ${current}/${total}...`);
      }, false, 'youtube');

      state.failedImports = result.failedItems.map((item) => ({ ...item, steamId: profileId, username, imageType: 'thumbnail', source: 'youtube' }));

      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      showFailedGames(overlay, state.failedImports);
      result.failedItems.forEach((item) => {
        const retryGame = { ...item, steamId: profileId, username, imageType: 'thumbnail', source: 'youtube' };
        logError(overlay, 'import', `${item.title || item.name} : ${item.error}`, { retryGame });
      });
      showMessage(
        overlay,
        `${result.imported} miniature(s) importee(s) pour "${username}"` +
          (result.failedItems.length ? `, ${result.failedItems.length} echec(s).` : '.'),
        result.failedItems.length > 0
      );
    } catch (err) {
      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      showMessage(overlay, err.message || String(err), true);
      logError(overlay, 'import', `${username}: ${err.message || err}`);
    }
  }

  /** Importe les jaquettes des jeux Steam en cache (100%/possedes/joues selon le filtre courant). */
  async function handleImport(overlay, fileInput, profileId, username) {
    const { showMessage, showFailedGames, setButtonsBusy, setProgress, logError } = global.TMContent;

    if (state.currentSource === 'letterboxd') {
      return global.TMContent.handleImportLetterboxd(overlay, fileInput, profileId, username);
    }
    if (state.currentSource === 'youtube') {
      return handleImportYouTube(overlay, fileInput, profileId, username);
    }

    const gamesData = await TMStorage.getGamesForUser(profileId);
    if (!gamesData || gamesData.completed.length === 0) {
      showMessage(overlay, `Aucun jeu termine a 100% pour "${username}". Cliquez sur "Recharger" d'abord.`, true);
      return;
    }

    showMessage(overlay, '', false);
    showFailedGames(overlay, null);
    setButtonsBusy(overlay, true);
    setProgress(overlay, 0, gamesData.completed.length, `Téléchargement des jaquettes de ${username} : 0/${gamesData.completed.length}...`);

    try {
      const result = await importItemsAsImages(fileInput, gamesData.completed, state.imageType, (current, total) => {
        setProgress(overlay, current, total, `Téléchargement des jaquettes de ${username} : ${current}/${total}...`);
      });

      state.failedImports = result.failedItems.map((item) => ({ ...item, steamId: profileId, username, imageType: item.imageType || state.imageType }));

      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      showFailedGames(overlay, state.failedImports);
      result.failedItems.forEach((item) => {
        const retryGame = { ...item, steamId: profileId, username, imageType: item.imageType || state.imageType };
        logError(overlay, 'import', `${item.name} (id ${item.appid || item.gameId || item.id}) : ${item.error}`, { retryGame });
      });
      showMessage(
        overlay,
        `${result.imported} image(s) importée(s) pour "${username}"` +
          (result.failedItems.length ? `, ${result.failedItems.length} échec(s) (voir la liste ci-dessous).` : '.'),
        result.failedItems.length > 0
      );
    } catch (err) {
      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      showMessage(overlay, err.message || String(err), true);
      logError(overlay, 'import', `${username}: ${err.message || err}`);
    }
  }

  /** Relance l'import des jeux/videos listes dans `items` (depuis le panneau lateral ou le journal). */
  async function retryImportFailures(overlay, items, origin) {
    const { showMessage, setButtonsBusy, setProgress, showFailedGames, updateLogsButton } = global.TMContent;
    const { logError, getFailedImportKey, removeResolvedImportFailures, updateFailedImportFailures, reopenLogsModal } = global.TMContent;

    if (!overlay || !items || items.length === 0) return;

    const fileInput = state.fileInput;
    if (!fileInput) {
      showMessage(overlay, "Impossible de relancer l'import : champ de fichiers introuvable.", true);
      return;
    }

    setButtonsBusy(overlay, true);
    setProgress(overlay, 0, items.length, `Relance des imports échoués : 0/${items.length}...`);

    try {
      const firstItemSource = items[0] && items[0].source ? items[0].source : state.currentSource;
      const result = await importItemsAsImages(fileInput, items, state.imageType, (current, total) => {
        setProgress(overlay, current, total, `Relance des imports échoués : ${current}/${total}...`);
      }, true, firstItemSource);

      const stillFailedKeys = new Set(result.failedItems.map((item) => getFailedImportKey(item)));
      const resolvedItems = items.filter((item) => !stillFailedKeys.has(getFailedImportKey(item)));

      removeResolvedImportFailures(resolvedItems);
      updateFailedImportFailures(result.failedItems);

      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      showFailedGames(overlay, state.failedImports);
      updateLogsButton(overlay);
      reopenLogsModal();

      if (result.failedItems.length > 0) {
        showMessage(
          overlay,
          `${result.imported} image(s) relancée(s) avec succès, ${result.failedItems.length} échec(s) restant(s).`,
          true
        );
      } else {
        showMessage(
          overlay,
          `${result.imported} image(s) relancée(s) avec succès depuis ${origin === 'logs' ? 'le journal' : 'le panneau latéral'}.`,
          false
        );
      }
    } catch (err) {
      setProgress(overlay, null);
      setButtonsBusy(overlay, false);
      showMessage(overlay, err.message || String(err), true);
      logError(overlay, 'import', `Relance impossible : ${err.message || err}`);
      reopenLogsModal();
    }
  }

  Object.assign(global.TMContent, { handleImport, retryImportFailures, importItemsAsImages });
})(typeof window !== 'undefined' ? window : this);

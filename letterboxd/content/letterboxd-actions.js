(function (global) {
  'use strict';

  const { state } = global.TMContent;

  async function handleReloadLetterboxd(overlay, profileId, username) {
    const ui = global.TMContent;
    ui.showMessage(overlay, '', false);
    ui.showFailedGames(overlay, null);
    ui.setButtonsBusy(overlay, true);
    try {
      await ui.flushLetterboxdSettings?.();
      const profiles = await TMStorage.getLetterboxdProfiles();
      const profile = profiles[profileId];
      if (!profile) throw new Error('Compte ou réalisateur Letterboxd introuvable.');
      const filters = { ...state.letterboxdFilters };
      const catalog = await TMLetterboxdClient.reloadCatalog(profile, filters, (count, page) =>
        ui.setProgress(overlay, 0, 1, `Letterboxd : page ${page}, ${count} film(s) lu(s)...`));
      if (catalog.avatar) await TMStorage.saveLetterboxdProfile(profileId, { avatar: catalog.avatar });
      await TMStorage.saveLetterboxdCatalog(profileId, { ...catalog, lastFetched: Date.now() });
      state.logs = state.logs.filter((entry) => entry.retryReload?.source !== 'letterboxd' || entry.retryReload.profileId !== profileId);
      ui.updateLogsButton(overlay);
      await ui.renderUsersList(overlay);
      ui.showMessage(overlay, `${catalog.totalItems} film(s) chargé(s) pour "${username}".`, false);
    } catch (error) {
      ui.showMessage(overlay, error.message, true);
      ui.logError(overlay, 'reload', `${username} : ${error.message}`, {
        retryReload: { source: 'letterboxd', profileId, username }
      });
    } finally {
      ui.setProgress(overlay, null);
      ui.setButtonsBusy(overlay, false);
    }
  }

  async function handleImportLetterboxd(overlay, fileInput, profileId, username) {
    const ui = global.TMContent;
    ui.showMessage(overlay, '', false);
    ui.showFailedGames(overlay, null);
    ui.setButtonsBusy(overlay, true);
    try {
      await ui.flushLetterboxdSettings?.();
      const profile = (await TMStorage.getLetterboxdProfiles())[profileId];
      if (!profile) throw new Error('Source Letterboxd introuvable.');
      const filters = TMLetterboxdFilters.validate({ ...state.letterboxdFilters }, profile.type);
      const cached = await TMStorage.getLetterboxdCatalog(profileId);
      const collection = profile.type === 'director' ? 'filmography' : filters.collection;
      if (!cached || cached.collection !== collection) {
        throw new Error('Rechargez ce compte avec le catalogue sélectionné avant d’importer.');
      }
      if (!cached.items.length) throw new Error('Le catalogue Letterboxd est vide.');

      const needsDetails = ['durationMin', 'durationMax', 'averageMin', 'averageMax', 'genres', 'countries', 'languages', 'director', 'actor']
        .some((key) => filters[key] !== '') || ['duration', 'averageRating'].includes(filters.sort) ||
        ((filters.yearMin !== '' || filters.yearMax !== '') && cached.items.some((item) => item.year == null));
      let items = cached.items;
      if (needsDetails) {
        items = await TMLetterboxdClient.prepareItems(items, (count, total) =>
          ui.setProgress(overlay, count, total, `Lecture des détails Letterboxd : ${count}/${total}...`));
        await TMStorage.saveLetterboxdCatalog(profileId, { ...cached, items });
      }
      const selected = TMLetterboxdFilters.filterItems(items, filters, profile.type);
      if (!selected.length) throw new Error('Aucun film ne correspond aux filtres Letterboxd.');
      const result = await ui.importItemsAsImages(fileInput, selected, 'poster', (count, total) =>
        ui.setProgress(overlay, count, total, `Import des affiches : ${count}/${total}...`), false, 'letterboxd');
      state.failedImports = result.failedItems.map((item) => ({
        ...item, source: 'letterboxd', profileId, username, imageType: 'poster'
      }));
      ui.showFailedGames(overlay, state.failedImports);
      state.failedImports.forEach((retryGame) =>
        ui.logError(overlay, 'import', `${retryGame.name} : ${retryGame.error}`, { retryGame }));
      ui.showMessage(overlay, `${result.imported} affiche(s) importée(s), ${result.failedItems.length} échec(s).`, result.failedItems.length > 0);
    } catch (error) {
      if (error.failedItems) {
        state.failedImports = error.failedItems.map((item) => ({
          ...item, source: 'letterboxd', profileId, username, imageType: 'poster'
        }));
        ui.showFailedGames(overlay, state.failedImports);
        state.failedImports.forEach((retryGame) =>
          ui.logError(overlay, 'import', `${retryGame.name} : ${retryGame.error}`, { retryGame }));
      }
      ui.showMessage(overlay, error.message, true);
      ui.logError(overlay, 'import', `${username} : ${error.message}`);
    } finally {
      ui.setProgress(overlay, null);
      ui.setButtonsBusy(overlay, false);
    }
  }

  Object.assign(global.TMContent, { handleReloadLetterboxd, handleImportLetterboxd });
})(typeof window !== 'undefined' ? window : this);

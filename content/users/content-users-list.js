/**
 * content/content-users-list.js
 *
 * Rendu de la liste des comptes/chaines enregistres dans la modale (une
 * ligne par compte : avatar, statistiques, date de derniere synchronisation,
 * actions recharger/importer/supprimer).
 */
(function (global) {
  'use strict';

  const { state, isGameSource, getSteamGameFilterMeta, formatDate, escapeHtml, renderIcon } = global.TMContent;

  /** Construit le libelle de statistiques (ex: "12 jeu(x) a 100%") affiche sous le nom du compte. */
  function buildStatsText(cachedData) {
    if (!cachedData) return 'Jamais recharge';
    if (state.currentSource === 'letterboxd') {
      const collection = global.TMLetterboxdFilters.COLLECTIONS[cachedData.collection] || 'Filmographie';
      return `${cachedData.items.length} film(s) • ${collection}`;
    }
    if (isGameSource(state.currentSource)) {
      const filterMeta = getSteamGameFilterMeta(cachedData.filterMode);
      const unverifiedSuffix = cachedData.failedCount ? ` (${cachedData.failedCount} non verifie(s), rechargez)` : '';
      return `${cachedData.completed.length} ${filterMeta.statsLabel}${unverifiedSuffix}`;
    }
    const itemCount = cachedData.totalItems || (cachedData.items && cachedData.items.length) || 0;
    return `${itemCount} miniature(s) detectee(s)`;
  }

  function buildSubLabel(user, cachedData, statsText, dateText) {
    if (isGameSource(state.currentSource)) {
      return `${statsText} • Maj : ${dateText}`;
    }
    const playlistSubtitle = user.type === 'playlist' && user.subtitle ? ` • ${escapeHtml(user.subtitle)}` : '';
    if (state.currentSource === 'letterboxd') {
      return `${user.type === 'director' ? 'Réalisateur' : 'Compte'} • ${statsText} • Maj : ${dateText}`;
    }
    return `${statsText}${playlistSubtitle} • Maj : ${dateText}`;
  }

  function renderUserRow(profileId, user, cachedData) {
    const hasData = !!cachedData;
    const statsText = buildStatsText(cachedData);
    const dateText = hasData ? formatDate(cachedData.lastFetched) : 'jamais';
    const name = escapeHtml(user.personaname || user.title || profileId);
    const subLabel = buildSubLabel(user, cachedData, statsText, dateText);
    const avatar = user.avatar
      ? `<img src="${escapeHtml(user.avatar)}" alt="" class="tm-user-avatar" referrerpolicy="no-referrer">`
      : '<span class="tm-user-avatar tm-user-avatar-placeholder"></span>';

    const hasImportableData = hasData && (isGameSource(state.currentSource) ? cachedData.completed.length > 0 : cachedData.items && cachedData.items.length > 0);
    const hasUnverifiedGames = isGameSource(state.currentSource) && hasData && cachedData.failed && cachedData.failed.length > 0;

    return `
      <div class="tm-user-row" data-profile-id="${escapeHtml(profileId)}">
        ${avatar}
        <div class="tm-user-info">
          <strong class="tm-user-name">${name}</strong>
          <span class="tm-user-meta">${subLabel}</span>
        </div>
        <div class="tm-user-actions">
          ${hasUnverifiedGames
            ? `<button type="button" class="tm-icon-btn tm-unverified-row" title="${cachedData.failed.length} jeu(x) non verifie(s)">${renderIcon('info', 'tm-btn-icon', 'Jeux non verifies')}</button>`
            : ''}
          <button type="button" class="tm-icon-btn tm-reload-row" title="Recharger les données">${renderIcon('reload', 'tm-btn-icon', 'Recharger les données')}</button>
          <button type="button" class="tm-icon-btn tm-import-row" title="Importer les images" ${hasImportableData ? '' : 'disabled'}>${renderIcon('import', 'tm-btn-icon', 'Importer les images')}</button>
          <button type="button" class="tm-icon-btn tm-delete-row" title="Supprimer ce compte">${renderIcon('delete', 'tm-btn-icon', 'Supprimer ce compte')}</button>
        </div>
      </div>
    `;
  }

  /** Reconstruit entierement la liste des comptes enregistres dans la modale. */
  async function renderUsersList(overlay) {
    const listEl = overlay.querySelector('#tm-users-list');
    const users = state.currentSource === 'steam'
      ? await TMStorage.getUsers()
      : state.currentSource === 'letterboxd' ? await TMStorage.getLetterboxdProfiles() : await TMStorage.getYouTubeUsers();
    const entries = Object.entries(users);

    if (entries.length === 0) {
      listEl.innerHTML = state.currentSource === 'steam'
        ? ''
        : '<p class="tm-muted tm-no-users">Aucune source enregistree.</p>';
      return;
    }

    const rows = await Promise.all(
      entries.map(async ([profileId, user]) => {
        const cachedData = state.currentSource === 'steam'
          ? await TMStorage.getGamesForUser(profileId)
          : state.currentSource === 'letterboxd'
            ? await TMStorage.getLetterboxdCatalog(profileId) : await TMStorage.getYouTubeItemsForUser(profileId);
        return renderUserRow(profileId, user, cachedData);
      })
    );

    listEl.innerHTML = rows.join('');
  }

  Object.assign(global.TMContent, { renderUsersList });
})(typeof window !== 'undefined' ? window : this);

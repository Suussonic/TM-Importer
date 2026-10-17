/**
 * content/content-logs-unverified.js
 *
 * Popup listant les jeux Steam dont la completion n'a pas pu etre verifiee
 * automatiquement, avec possibilite de les marquer termines manuellement.
 * Separe de content-logs.js pour garder chaque fichier sous 250 lignes.
 */
(function (global) {
  'use strict';

  const { escapeHtml, renderIcon } = global.TMContent;

  function renderUnverifiedGamesList(unverifiedGames) {
    if (unverifiedGames.length === 0) {
      return '<p class="tm-muted tm-no-users">Tous les jeux ont été vérifiés.</p>';
    }
    return unverifiedGames
      .map(
        (game) => `
          <div class="tm-logs-entry">
            <div class="tm-logs-entry-header">
              <div class="tm-logs-entry-meta">
                <span class="tm-logs-entry-badge">${escapeHtml(game.name)}</span>
              </div>
              <div class="tm-logs-entry-actions">
                <button type="button" class="tm-btn tm-unverified-add-btn" data-appid="${game.appid}">Ajouter manuellement</button>
              </div>
            </div>
            <div class="tm-logs-entry-message">${escapeHtml(game.message || '')}</div>
          </div>
        `
      )
      .join('');
  }

  /** Ouvre une popup listant les jeux Steam non verifies d'un compte, avec ajout manuel possible. */
  async function openUnverifiedGamesModal(overlay, steamId, username) {
    if (document.getElementById('tm-unverified-overlay')) return;

    const cachedData = await TMStorage.getGamesForUser(steamId);
    const unverifiedGames = (cachedData && cachedData.failed) || [];

    const unverifiedOverlay = document.createElement('div');
    unverifiedOverlay.id = 'tm-unverified-overlay';
    unverifiedOverlay.className = 'tm-overlay';
    unverifiedOverlay.innerHTML = `
      <div class="tm-modal tm-logs-modal">
        <span class="tm-close" title="Fermer">${renderIcon('close', 'tm-close-icon', 'Fermer')}</span>
        <div class="tm-logs-title-row">
          <h3><span class="tm-logs-title-icon">${renderIcon('info', 'tm-title-icon-svg', 'Info')}</span> Jeux non vérifiés (${escapeHtml(username)})</h3>
          <span class="tm-logs-count">${unverifiedGames.length}</span>
        </div>
        <p class="tm-logs-toolbar-text">Steam n'a pas pu confirmer si ces jeux sont à 100% (endpoint indisponible pour ce jeu précis). Si vous savez qu'un jeu est terminé, ajoutez-le manuellement.</p>
        <div id="tm-unverified-list" class="tm-logs-list">${renderUnverifiedGamesList(unverifiedGames)}</div>
      </div>
    `;
    document.body.appendChild(unverifiedOverlay);

    unverifiedOverlay.addEventListener('click', (evt) => {
      if (evt.target === unverifiedOverlay) unverifiedOverlay.remove();
    });
    unverifiedOverlay.querySelector('.tm-close').addEventListener('click', () => unverifiedOverlay.remove());

    unverifiedOverlay.querySelector('#tm-unverified-list').addEventListener('click', async (evt) => {
      const addBtn = evt.target.closest('.tm-unverified-add-btn');
      if (!addBtn) return;
      const appid = Number(addBtn.dataset.appid);
      const index = unverifiedGames.findIndex((game) => game.appid === appid);
      if (index === -1) return;
      const [game] = unverifiedGames.splice(index, 1);

      const currentData = await TMStorage.getGamesForUser(steamId);
      if (currentData) {
        currentData.completed = [...currentData.completed, { appid: game.appid, name: game.name, iconUrl: '' }];
        currentData.failed = (currentData.failed || []).filter((item) => item.appid !== appid);
        currentData.failedCount = currentData.failed.length;
        await TMStorage.saveGamesForUser(steamId, currentData);
      }

      unverifiedOverlay.querySelector('#tm-unverified-list').innerHTML = renderUnverifiedGamesList(unverifiedGames);
      await global.TMContent.renderUsersList(overlay);
    });
  }

  Object.assign(global.TMContent, { openUnverifiedGamesModal });
})(typeof window !== 'undefined' ? window : this);

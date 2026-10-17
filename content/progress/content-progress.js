/**
 * content/content-progress.js
 *
 * Petits helpers d'affichage partages par les modules d'action (message de
 * statut, barre de progression, verrouillage des boutons pendant une
 * operation, panneau des imports en echec, resultats de recherche).
 */
(function (global) {
  'use strict';

  const { escapeHtml, getFailedImportKey, renderIcon } = global.TMContent;

  function showMessage(overlay, text, isError) {
    const el = overlay.querySelector('#tm-message');
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
    el.classList.toggle('tm-message-error', !!isError);
  }

  function setProgress(overlay, current, total, label) {
    const progressEl = overlay.querySelector('#tm-progress');
    if (current == null) {
      progressEl.style.display = 'none';
      return;
    }
    progressEl.style.display = 'block';
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    overlay.querySelector('#tm-progress-fill').style.width = percent + '%';
    overlay.querySelector('#tm-progress-label').textContent =
      label || `Analyse des succès Steam : ${current}/${total} jeu(x) vérifié(s)...`;
  }

  function setButtonsBusy(overlay, busy) {
    overlay.querySelectorAll('button, select, input').forEach((el) => {
      el.disabled = busy;
    });
  }

  /** Affiche (ou masque) le panneau des jeux/videos dont l'import a echoue. */
  function showFailedGames(overlay, failedItems) {
    const container = overlay.querySelector('#tm-failed-games');
    const list = overlay.querySelector('#tm-failed-games-list');
    list.innerHTML = '';

    if (!failedItems || failedItems.length === 0) {
      container.style.display = 'none';
      return;
    }

    failedItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'tm-failed-game-row';
      row.innerHTML = `
        <div class="tm-failed-game-info">
          <strong class="tm-failed-game-name">${escapeHtml(item.name || item.title)}</strong>
          <span class="tm-failed-game-error">${escapeHtml(item.error)}</span>
        </div>
        <button type="button" class="tm-icon-btn tm-retry-failed-game-btn" data-failed-key="${escapeHtml(getFailedImportKey(item))}" title="Relancer cet import">${renderIcon('reload', 'tm-btn-icon', 'Relancer cet import')}</button>
      `;
      list.appendChild(row);
    });
    container.style.display = 'block';
  }

  /** Masque et vide la liste deroulante des resultats de recherche. */
  function hideSearchResults(overlay) {
    const results = overlay.querySelector('#tm-search-results');
    results.style.display = 'none';
    results.innerHTML = '';
  }

  Object.assign(global.TMContent, { showMessage, setProgress, setButtonsBusy, showFailedGames, hideSearchResults });
})(typeof window !== 'undefined' ? window : this);

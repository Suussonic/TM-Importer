/**
 * content/content-logs.js
 *
 * Journal des erreurs de la session (bouton "Voir les logs" + popup avec
 * copie), et popup dediee aux jeux Steam dont la completion n'a pas pu etre
 * verifiee (ajout manuel possible).
 */
(function (global) {
  'use strict';

  const { state, escapeHtml, renderIcon } = global.TMContent;

  /** Cle stable identifiant un import (source + identifiant du jeu/video + type d'image). */
  function getFailedImportKey(item) {
    const source = item.source || state.currentSource;
    const entityId = source === 'youtube' ? (item.videoId || item.id) : (item.appid || item.gameId || item.id);
    return `${source}:${entityId}:${item.imageType || state.imageType}`;
  }

  /** Enregistre une erreur dans le journal de session et met a jour le bouton "Voir les logs". */
  function logError(overlay, context, message, extra = {}) {
    state.logs.push({ id: state.nextLogId++, time: Date.now(), context, message: String(message), ...extra });
    updateLogsButton(overlay);
  }

  /** Formate le journal d'erreurs en texte brut (pour affichage et copie). */
  function formatLogsAsText() {
    return state.logs
      .map((entry) => `[${new Date(entry.time).toLocaleString('fr-FR')}] (${entry.context}) ${entry.message}`)
      .join('\n');
  }

  /** Construit le HTML de la liste des erreurs (une "carte" par entree). */
  function renderLogEntries() {
    return state.logs
      .map((entry) => {
        const time = new Date(entry.time).toLocaleString('fr-FR');
        const retryLabel = entry.retryReload ? 'Recharger ce catalogue' : 'Relancer cet import';
        const retryButton = entry.retryGame || entry.retryReload
          ? `<button type="button" class="tm-icon-btn tm-log-retry-btn" data-log-id="${entry.id}" title="${retryLabel}">${renderIcon('reload', 'tm-btn-icon', retryLabel)}</button>`
          : '';
        return `
          <div class="tm-logs-entry">
            <div class="tm-logs-entry-header">
              <div class="tm-logs-entry-meta">
                <span class="tm-logs-entry-badge">${escapeHtml(entry.context)}</span>
                <span class="tm-logs-entry-time">${escapeHtml(time)}</span>
              </div>
              <div class="tm-logs-entry-actions">${retryButton}</div>
            </div>
            <div class="tm-logs-entry-message">${escapeHtml(entry.message)}</div>
          </div>
        `;
      })
      .join('');
  }

  function getRetryableImportLogs() {
    return state.logs.filter((entry) => !!entry.retryGame);
  }

  /** Retire du journal et de la liste "a relancer" les imports desormais resolus. */
  function removeResolvedImportFailures(resolvedItems) {
    const resolvedKeys = new Set(resolvedItems.map((item) => getFailedImportKey(item)));
    state.failedImports = state.failedImports.filter((item) => !resolvedKeys.has(getFailedImportKey(item)));
    state.logs = state.logs.filter((entry) => !entry.retryGame || !resolvedKeys.has(getFailedImportKey(entry.retryGame)));
  }

  /** Met a jour le journal et la liste "a relancer" avec les imports toujours en echec apres une relance. */
  function updateFailedImportFailures(stillFailedItems) {
    const failedByKey = new Map(stillFailedItems.map((item) => [getFailedImportKey(item), item]));
    state.failedImports = state.failedImports
      .map((item) => failedByKey.get(getFailedImportKey(item)) || item)
      .filter((item) => failedByKey.has(getFailedImportKey(item)));

    state.logs = state.logs.map((entry) => {
      if (!entry.retryGame) return entry;
      const updatedItem = failedByKey.get(getFailedImportKey(entry.retryGame));
      if (!updatedItem) return entry;
      return {
        ...entry,
        time: Date.now(),
        message: updatedItem.source === 'youtube'
          ? `${updatedItem.title || updatedItem.name} : ${updatedItem.error}`
          : `${updatedItem.name} (id ${updatedItem.appid || updatedItem.gameId || updatedItem.id}) : ${updatedItem.error}`,
        retryGame: updatedItem
      };
    });
  }

  /** Rouvre la popup de logs (si elle etait ouverte) apres une mise a jour du journal. */
  function reopenLogsModal() {
    const logsOverlay = document.getElementById('tm-logs-overlay');
    if (!logsOverlay) return;
    logsOverlay.remove();
    if (state.logs.length > 0) {
      openLogsModal();
    }
  }

  /** Affiche/masque et met a jour le libelle du bouton "Voir les logs". */
  function updateLogsButton(overlay) {
    const btn = overlay.querySelector('#tm-view-logs-btn');
    if (!btn) return;
    if (state.logs.length > 0) {
      btn.style.display = 'flex';
      btn.innerHTML = `${renderIcon('warning', 'tm-inline-icon', 'Voir les logs')}<span>Voir les logs (${state.logs.length})</span>`;
    } else {
      btn.style.display = 'none';
      btn.innerHTML = '';
    }
  }

  /** Copie un texte dans le presse-papier, avec repli si l'API Clipboard echoue. */
  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  /** Ouvre une popup listant toutes les erreurs journalisees durant la session, avec bouton "Copier tout". */
  function openLogsModal() {
    if (document.getElementById('tm-logs-overlay')) return;

    const errorCount = state.logs.length;
    const retryableCount = getRetryableImportLogs().length;
    const reloadCount = state.logs.filter((entry) => !!entry.retryReload).length;
    const overlay = document.createElement('div');
    overlay.id = 'tm-logs-overlay';
    overlay.className = 'tm-overlay';
    overlay.innerHTML = `
      <div class="tm-modal tm-logs-modal">
        <span class="tm-close" title="Fermer">${renderIcon('close', 'tm-close-icon', 'Fermer')}</span>
        <div class="tm-logs-title-row">
          <h3><span class="tm-logs-title-icon">${renderIcon('warning', 'tm-title-icon-svg', 'Erreur')}</span> Journal des erreurs</h3>
          <span class="tm-logs-count">${errorCount} erreur${errorCount > 1 ? 's' : ''}</span>
        </div>
        <div class="tm-logs-toolbar">
          <p class="tm-logs-toolbar-text">${retryableCount > 0 ? `${retryableCount} erreur(s) d'import peuvent être relancées directement.` : reloadCount > 0 ? 'Relancez le catalogue avec le bouton de son erreur.' : 'Aucune relance directe disponible pour les erreurs listées.'}</p>
          <button type="button" id="tm-retry-logs-btn" class="tm-icon-btn tm-btn-retry-logs" title="Relancer tous les imports" ${retryableCount === 0 ? 'disabled' : ''}>${renderIcon('reload', 'tm-btn-icon', 'Relancer tous les imports')}</button>
        </div>
        <div id="tm-logs-list" class="tm-logs-list">${renderLogEntries()}</div>
        <div class="tm-logs-actions">
          <button type="button" id="tm-copy-logs-btn" class="tm-icon-btn tm-btn-copy-logs" title="Copier tous les logs">${renderIcon('copy', 'tm-btn-icon', 'Copier tous les logs')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (evt) => {
      if (evt.target === overlay) overlay.remove();
    });
    overlay.querySelector('.tm-close').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#tm-retry-logs-btn').addEventListener('click', async () => {
      const retryableGames = getRetryableImportLogs().map((entry) => entry.retryGame);
      await global.TMContent.retryImportFailures(document.getElementById(global.TMContent.constants.MODAL_ID), retryableGames, 'logs');
    });

    overlay.querySelector('#tm-logs-list').addEventListener('click', async (evt) => {
      const retryBtn = evt.target.closest('.tm-log-retry-btn');
      if (!retryBtn) return;
      const logId = Number(retryBtn.dataset.logId);
      const entry = state.logs.find((item) => item.id === logId);
      if (!entry) return;
      if (entry.retryReload) {
        const mainOverlay = document.getElementById(global.TMContent.constants.MODAL_ID);
        if (!mainOverlay) return;
        overlay.remove();
        await global.TMContent.handleReloadYouTube(mainOverlay, entry.retryReload.profileId, entry.retryReload.username);
        return;
      }
      if (!entry.retryGame) return;
      await global.TMContent.retryImportFailures(document.getElementById(global.TMContent.constants.MODAL_ID), [entry.retryGame], 'logs');
    });

    const copyBtn = overlay.querySelector('#tm-copy-logs-btn');
    copyBtn.addEventListener('click', async () => {
      try {
        await copyTextToClipboard(formatLogsAsText());
        copyBtn.innerHTML = renderIcon('check', 'tm-btn-icon', 'Copie reussie');
        copyBtn.classList.add('tm-btn-copy-logs-success');
      } catch (err) {
        copyBtn.innerHTML = renderIcon('close', 'tm-btn-icon', 'Echec de la copie');
      }
      setTimeout(() => {
        copyBtn.innerHTML = renderIcon('copy', 'tm-btn-icon', 'Copier tous les logs');
        copyBtn.classList.remove('tm-btn-copy-logs-success');
      }, 1500);
    });
  }

  /** Ouvre une popup listant les jeux Steam non verifies d'un compte, avec ajout manuel possible. */
  // Voir content-logs-unverified.js : openUnverifiedGamesModal est enregistree
  // separement sur global.TMContent pour garder ce fichier sous 250 lignes.

  Object.assign(global.TMContent, {
    getFailedImportKey,
    logError,
    removeResolvedImportFailures,
    updateFailedImportFailures,
    reopenLogsModal,
    updateLogsButton,
    openLogsModal
  });
})(typeof window !== 'undefined' ? window : this);

/**
 * content/content-events-actions.js
 *
 * Ecouteurs d'evenements pour les actions "lourdes" de la modale :
 * connexion/deconnexion Steam, ajout YouTube et actions par ligne de compte
 * (recharger/importer/jeux non verifies/supprimer). Separe de
 * content-events.js pour garder chaque fichier sous 250 lignes.
 */
(function (global) {
  'use strict';

  const { state } = global.TMContent;

  /** Connexion Steam (OpenID) et ajout d'une source publique YouTube. */
  function bindAuthButtonEvents(overlay) {
    const { showMessage, setButtonsBusy, renderSourceUI, logError, closeModal } = global.TMContent;

    overlay.addEventListener('click', async (evt) => {
      if (evt.target.closest('#tm-steam-auth-btn')) {
        setButtonsBusy(overlay, true);
        try {
          if (state.steamAuth.connected) {
            state.steamAuth = { connected: false, steamId: '', personaname: '', avatar: '' };
            await TMStorage.saveSettings({ steamOpenId: state.steamAuth });
            showMessage(overlay, '', false);
          } else {
            const profile = await TMSteamClient.signInWithSteamOpenId();
            state.steamAuth = { connected: true, ...profile };
            await TMStorage.saveSettings({ steamOpenId: state.steamAuth });
            showMessage(overlay, '', false);
          }
          await renderSourceUI(overlay);
        } catch (err) {
          if (err.contextInvalidated || /Extension context invalidated/i.test(err.message || '')) {
            closeModal();
            return;
          }
          showMessage(overlay, err.message || String(err), true);
          logError(overlay, 'steam-auth', err.message || String(err));
        } finally {
          if (document.body.contains(overlay)) setButtonsBusy(overlay, false);
        }
      }

      if (evt.target.closest('#tm-youtube-add-btn')) {
        const { addUserAndRefreshList } = global.TMContent;
        const inputValue = overlay.querySelector('#tm-search-input')?.value.trim();
        if (!inputValue) {
          showMessage(overlay, 'Saisissez une chaine, un handle ou une URL de playlist YouTube.', true);
          return;
        }
        await addUserAndRefreshList(overlay, inputValue, 'youtube');
      }

    });
  }

  /** Actions par ligne de compte (recharger/importer/jeux non verifies/supprimer), en un seul ecouteur delegue. */
  function bindUserRowActions(overlay, fileInput) {
    const { handleReload, handleImport, openUnverifiedGamesModal, renderUsersList } = global.TMContent;

    overlay.querySelector('#tm-users-list').addEventListener('click', async (evt) => {
      const row = evt.target.closest('.tm-user-row');
      if (!row) return;
      const profileId = row.dataset.profileId;
      const username = row.querySelector('.tm-user-name').textContent;

      if (evt.target.closest('.tm-reload-row')) {
        await handleReload(overlay, profileId, username);
      } else if (evt.target.closest('.tm-import-row')) {
        await handleImport(overlay, fileInput, profileId, username);
      } else if (evt.target.closest('.tm-unverified-row')) {
        await openUnverifiedGamesModal(overlay, profileId, username);
      } else if (evt.target.closest('.tm-delete-row')) {
        if (state.currentSource === 'youtube') {
          await TMStorage.removeYouTubeUser(profileId);
        } else {
          await TMStorage.removeUser(profileId);
        }
        await renderUsersList(overlay);
      }
    });
  }

  Object.assign(global.TMContent, { bindAuthButtonEvents, bindUserRowActions });
})(typeof window !== 'undefined' ? window : this);

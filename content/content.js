/**
 * content/content.js
 *
 * Point d'entree du content script injecte sur tiermaker.com : ajoute un
 * bouton "Importer depuis un compte" sous le champ d'upload d'images natif,
 * qui ouvre la modale TM Importer (voir content-modal-lifecycle.js et
 * content-events.js pour la logique de la modale elle-meme).
 *
 * TM Importer est organise pour accueillir plusieurs sources (Steam,
 * YouTube...) : la logique propre a chaque source vit dans `steam/` et
 * `youtube/`, chargees avant ce fichier par le manifest, pendant que les
 * fichiers `content/*.js` ne gerent que l'UI generique de la modale.
 */
(function (global) {
  'use strict';

  const { constants, openModal } = global.TMContent;
  const { UPLOAD_INPUT_SELECTOR, IMPORT_BUTTON_ID } = constants;

  function injectImportButtonIfNeeded() {
    const fileInput = document.querySelector(UPLOAD_INPUT_SELECTOR);
    if (!fileInput || document.getElementById(IMPORT_BUTTON_ID)) return;

    const uploadWrapper = fileInput.closest('.action') || fileInput.parentElement;

    const importButton = document.createElement('button');
    importButton.id = IMPORT_BUTTON_ID;
    importButton.type = 'button';
    importButton.className = 'tm-import-trigger';
    importButton.textContent = 'Importer depuis un compte';
    importButton.addEventListener('click', () => openModal(fileInput));

    uploadWrapper.insertAdjacentElement('afterend', importButton);
  }

  // Certaines pages TierMaker construisent le DOM dynamiquement : on observe
  // les mutations pour injecter le bouton des que le champ d'upload apparait.
  const uploadFieldObserver = new MutationObserver(() => injectImportButtonIfNeeded());
  uploadFieldObserver.observe(document.documentElement, { childList: true, subtree: true });
  injectImportButtonIfNeeded();
})(typeof window !== 'undefined' ? window : this);

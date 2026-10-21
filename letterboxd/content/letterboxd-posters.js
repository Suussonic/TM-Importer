(function (global) {
  'use strict';

  const posters = new Set();
  let observer;

  function markPoster(node) {
    if (node.nodeType !== 1) return;
    const candidates = node.matches('.character.extra-images') ? [node] : [];
    candidates.push(...node.querySelectorAll('.character.extra-images'));
    for (const candidate of candidates) {
      const image = candidate.querySelector('img.draggable-filler');
      if (image && posters.has(image.getAttribute('src'))) {
        candidate.classList.add('tm-letterboxd-poster');
      }
    }
  }

  function registerLetterboxdPoster(dataUrl) {
    posters.add(dataUrl);
    if (!observer) {
      // TierMaker creates the tiles asynchronously after reading the uploaded files.
      observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) markPoster(node);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  global.TMContent.registerLetterboxdPoster = registerLetterboxdPoster;
})(typeof window !== 'undefined' ? window : this);

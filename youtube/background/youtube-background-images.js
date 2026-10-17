/**
 * youtube/youtube-background-images.js
 *
 * Telechargement des miniatures YouTube depuis le service worker.
 */
(function (global) {
  'use strict';

  const ALLOWED_IMAGE_HOSTS = ['i.ytimg.com', 'i9.ytimg.com', 'yt3.googleusercontent.com', 'yt3.ggpht.com'];

  function assertAllowedImageUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      throw new Error('URL YouTube invalide.');
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.includes(parsed.hostname)) {
      throw new Error('URL YouTube non autorisee.');
    }
  }

  async function blobToDataUrl(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
  }

  async function fetchYouTubeImageDataUrl(url) {
    assertAllowedImageUrl(url);
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      throw new Error(`Miniature YouTube introuvable (HTTP ${res.status}).`);
    }
    return blobToDataUrl(await res.blob());
  }

  /**
   * Essaie plusieurs URLs de miniature dans l'ordre et retourne la premiere
   * qui reussit. La qualite renvoyee par l'API (maxres/standard) n'existe
   * pas toujours reellement sur le CDN (404 frequent, notamment pour les
   * shorts/anciennes videos) : on retombe sur les formats generes
   * automatiquement par YouTube pour toute video publique valide
   * (hqdefault.jpg, quasi jamais absent), construits depuis le videoId.
   */
  async function fetchYouTubeImageDataUrlWithFallback(candidateUrls) {
    const uniqueCandidates = [...new Set((candidateUrls || []).filter(Boolean))];
    if (uniqueCandidates.length === 0) {
      throw new Error('Aucune URL de miniature YouTube disponible.');
    }
    let lastError;
    for (const candidate of uniqueCandidates) {
      try {
        return await fetchYouTubeImageDataUrl(candidate);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  global.TMYouTubeImages = { fetchYouTubeImageDataUrlWithFallback };
})(typeof self !== 'undefined' ? self : this);

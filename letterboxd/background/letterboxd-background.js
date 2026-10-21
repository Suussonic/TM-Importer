(function (global) {
  'use strict';

  function assertPageUrl(value) {
    const url = new URL(value, 'https://letterboxd.com');
    if (url.origin !== 'https://letterboxd.com' || url.username || url.password ||
        url.search || url.hash || !/^\/(?:[a-z0-9_-]+\/)+$/i.test(url.pathname)) {
      throw new Error('URL publique Letterboxd non autorisee.');
    }
    return url.href;
  }

  function assertImageUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['a.ltrbxd.com', 's.ltrbxd.com'].includes(url.hostname) ||
        url.port || url.username || url.password || /empty-poster/i.test(url.pathname)) {
      throw new Error("URL d'affiche Letterboxd non autorisee.");
    }
    return url.href;
  }

  async function fetchResource(url, image = false) {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      const advice = response.status === 403 || response.status === 429
        ? ' Acces bloque ou limite par Letterboxd : reessayez plus tard, sans contournement.'
        : '';
      throw new Error(`Letterboxd : ${new URL(url).pathname} (HTTP ${response.status}).${advice}`);
    }
    if (image) {
      const blob = await response.blob();
      if (!/^image\/(?:jpeg|png|webp|avif)$/.test(blob.type)) {
        throw new Error("Letterboxd n'a pas renvoye une image valide.");
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return { dataUrl: `data:${blob.type};base64,${btoa(binary)}` };
    }
    const html = await response.text();
    if (/Just a moment\.\.\.|cf-chl-|id=["']challenge-form|<title>[^<]*(?:Access denied|Attention Required)/i.test(html)) {
      throw new Error('Protection anti-robot Letterboxd : acces refuse, aucun contournement effectue.');
    }
    return { html };
  }

  const handlers = {
    LETTERBOXD_PAGE: async ({ url }) => fetchResource(assertPageUrl(url)),
    LETTERBOXD_IMAGE: async ({ url }) => fetchResource(assertImageUrl(url), true)
  };
  global.TMLetterboxdBackground = { handlers, assertPageUrl, assertImageUrl };
})(typeof self !== 'undefined' ? self : this);

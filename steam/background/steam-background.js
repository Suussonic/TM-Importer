/**
 * steam/steam-background.js
 *
 * Point d'entree Steam cote service worker : appels Steam Web API JSON
 * officiels (bibliotheque, succes) et routeur de messages exposant
 * `TMSteamBackground.handlers` a `background/background.js`. Assemble les
 * modules charges avant celui-ci (steam-background-community.js,
 * steam-background-openid.js, steam-background-images.js).
 *
 * Messages geres :
 *   - FETCH_TEXT           { url }                -> { text }
 *   - STEAM_OPENID_SIGN_IN {}                     -> { steamId, apiKey }
 *   - STEAM_API_REQUEST    { method, params }     -> { data }
 *   - FETCH_IMAGE          { appid, type, url }    -> { dataUrl }
 */
(function (global) {
  'use strict';

  const { fetchSteamCommunityText } = global.TMSteamCommunity;
  const { signInWithSteamOpenId } = global.TMSteamOpenId;
  const { fetchGameImageDataUrl, getSteamImageUrl } = global.TMSteamImages;

  const STEAM_WEB_API_BASE = 'https://api.steampowered.com/';
  const STEAM_WEB_API_METHODS = new Set([
    'IPlayerService/GetOwnedGames/v0001/',
    'ISteamUserStats/GetPlayerAchievements/v0001/',
    'ISteamUserStats/GetUserStatsForGame/v0002/',
    'IPlayerService/GetAchievementsProgress/v1/',
    'ISteamUser/ResolveVanityURL/v0001/',
    'ISteamUser/GetPlayerSummaries/v0002/'
  ]);

  /** Lit la cle Steam Web API auto-obtenue lors de la connexion OpenID. */
  function getStoredApiKey() {
    return new Promise((resolve) => {
      chrome.storage.local.get('tm_settings', (result) => {
        resolve((result.tm_settings && result.tm_settings.steamApiKey) || '');
      });
    });
  }

  /** Appelle un endpoint Steam Web API JSON autorise avec la cle du compte connecte. */
  async function fetchSteamWebApi(method, params) {
    if (!STEAM_WEB_API_METHODS.has(method)) throw new Error('Endpoint Steam API non autorisé.');
    const apiKey = await getStoredApiKey();
    if (!apiKey) throw new Error('Connectez-vous avec Steam (carte en haut de la fenêtre) pour obtenir automatiquement une clé Steam Web API.');

    const url = new URL(method, STEAM_WEB_API_BASE);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('format', 'json');
    Object.entries(params || {}).forEach(([name, value]) => {
      if (value != null && value !== '') url.searchParams.set(name, String(value));
    });

    const res = await fetch(url.toString());
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      // Certains jeux renvoient un 500 en texte brut plutot qu'un JSON
      // {playerstats:{error}} : normalise vers le meme message.
      if (res.status >= 500) throw new Error(res.status === 500 ? 'Internal Server Error' : `Steam Web API indisponible (HTTP ${res.status}).`);
      // Vu sur les grosses bibliotheques (100+ jeux) : Steam renvoie une page
      // HTML de limitation de debit (429) au lieu du JSON attendu.
      if (res.status === 429) throw new Error('Trop de requetes Steam Web API (HTTP 429) : limite de debit temporaire.');
      throw new Error(`Réponse Steam Web API invalide (HTTP ${res.status}).`);
    }
    if (!res.ok) {
      if (res.status === 429) throw new Error('Trop de requetes Steam Web API (HTTP 429) : limite de debit temporaire.');
      const message = data && data.playerstats && data.playerstats.error;
      throw new Error(message || `Steam Web API a refusé la requête (HTTP ${res.status}). Vérifiez la confidentialité "Détails du jeu" du profil.`);
    }
    return data;
  }

  const handlers = {
    async FETCH_TEXT({ url }) {
      const text = await fetchSteamCommunityText(url);
      return { text };
    },

    async STEAM_OPENID_SIGN_IN() {
      return signInWithSteamOpenId();
    },

    async STEAM_API_REQUEST({ method, params }) {
      const data = await fetchSteamWebApi(method, params);
      return { data };
    },

    async FETCH_IMAGE({ appid, type, url }) {
      const dataUrl = await fetchGameImageDataUrl(appid, type, url);
      return { dataUrl };
    }
  };

  global.TMSteamBackground = { handlers, getSteamImageUrl };
})(typeof self !== 'undefined' ? self : this);

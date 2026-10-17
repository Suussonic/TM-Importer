/**
 * steam/steam-client.js
 *
 * Point d'entree de la couche Steam cote content script : connexion via le
 * Steam OpenID Provider officiel, telechargement des jaquettes, et
 * assemblage de l'API publique `TMSteamClient` a partir des modules charges
 * avant celui-ci (steam-client-network.js, steam-client-profile.js,
 * steam-client-games.js).
 *
 * Aucune cle API a saisir manuellement : la connexion OpenID obtient aussi
 * automatiquement une cle Steam Web API pour le compte connecte (voir
 * `signInWithSteamOpenId`, qui delegue au service worker).
 */
(function (global) {
  'use strict';

  const { sendMessageToBackground } = global.TMSteamNetwork;
  const { resolveProfile, searchUsers } = global.TMSteamProfile;
  const { getOwnedGames, isGameFullyCompleted, scanCompletedGames } = global.TMSteamGames;

  /**
   * Lance le flux officiel "Sign in through Steam" (OpenID 2.0). Le service
   * worker obtient aussi, dans le meme onglet authentifie, une cle Steam Web
   * API pour ce compte, enregistree ici pour que `getOwnedGames`/
   * `isGameFullyCompleted` puissent l'utiliser ensuite.
   */
  async function signInWithSteamOpenId() {
    const response = await sendMessageToBackground('STEAM_OPENID_SIGN_IN', {});
    if (response.error) throw new Error(response.error);
    await TMStorage.saveSettings({ steamApiKey: response.apiKey });
    return resolveProfile(response.steamId);
  }

  /** Telecharge la jaquette d'un jeu (via le service worker, pour les memes raisons de CORS) en dataURL base64. */
  async function fetchGameImage(appid, type, iconUrl) {
    const response = await sendMessageToBackground('FETCH_IMAGE', { appid, type, url: iconUrl });
    if (response.error) throw new Error(response.error);
    return response.dataUrl;
  }

  global.TMSteamClient = {
    resolveProfile,
    searchUsers,
    getOwnedGames,
    isGameFullyCompleted,
    scanCompletedGames,
    signInWithSteamOpenId,
    fetchGameImage
  };
})(typeof window !== 'undefined' ? window : this);

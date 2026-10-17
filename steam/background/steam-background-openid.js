/**
 * steam/steam-background-openid.js
 *
 * Connexion via le Steam OpenID Provider officiel
 * (https://steamcommunity.com/dev). Aucun mot de passe ne transite par
 * l'extension. La connexion s'effectue dans un VRAI onglet du navigateur
 * (meme pot de cookies que le reste du navigateur) plutot que via
 * `chrome.identity.launchWebAuthFlow`, car cette derniere ouvre sa page dans
 * une partition de stockage isolee qui ne pose aucun cookie de session
 * exploitable ensuite (bug connu de Chromium). Un onglet normal etablit la
 * vraie session Steam Community, ensuite reutilisee dans ce meme onglet pour
 * lire/enregistrer automatiquement la cle Steam Web API du compte (voir
 * steam-background-community.js).
 */
(function (global) {
  'use strict';

  const { fetchOrRegisterApiKey } = global.TMSteamCommunity;

  const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';

  function buildOpenIdLoginUrl(returnTo) {
    const url = new URL(STEAM_OPENID_ENDPOINT);
    url.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
    url.searchParams.set('openid.mode', 'checkid_setup');
    url.searchParams.set('openid.return_to', returnTo);
    url.searchParams.set('openid.realm', returnTo);
    url.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select');
    url.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select');
    return url.toString();
  }

  /** Revalide la reponse OpenID aupres de Steam et en extrait le SteamID64. */
  async function verifyOpenIdResponse(responseUrl) {
    const responseParams = new URL(responseUrl).searchParams;
    if (responseParams.get('openid.mode') !== 'id_res') {
      throw new Error('Connexion Steam annulée.');
    }

    const verifyUrl = new URL(STEAM_OPENID_ENDPOINT);
    verifyUrl.searchParams.set('openid.mode', 'check_authentication');
    for (const [key, value] of responseParams.entries()) {
      if (key === 'openid.mode') continue;
      verifyUrl.searchParams.set(key, value);
    }

    const res = await fetch(verifyUrl.toString());
    const text = await res.text();
    if (!/is_valid\s*:\s*true/i.test(text)) {
      throw new Error("Steam n'a pas pu valider la connexion.");
    }

    const claimedId = responseParams.get('openid.claimed_id') || '';
    const match = claimedId.match(/\/openid\/id\/(\d{17})$/);
    if (!match) {
      throw new Error('Identifiant Steam introuvable dans la réponse de connexion.');
    }
    return match[1];
  }

  /** Attend qu'un onglet navigue vers une URL commencant par `prefix`, ou soit ferme par l'utilisateur. */
  function waitForTabRedirect(tabId, prefix) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
      }
      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || !changeInfo.url) return;
        if (changeInfo.url.indexOf(prefix) === 0) {
          cleanup();
          resolve(changeInfo.url);
        }
      }
      function onRemoved(removedTabId) {
        if (removedTabId !== tabId) return;
        cleanup();
        reject(new Error('Connexion Steam annulée.'));
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  }

  /** Lance le flux officiel "Sign in through Steam" (OpenID) dans un vrai onglet, puis obtient la cle Steam Web API. */
  async function signInWithSteamOpenId() {
    const returnTo = chrome.identity.getRedirectURL();
    const authUrl = buildOpenIdLoginUrl(returnTo);

    let tab;
    try {
      tab = await chrome.tabs.create({ url: authUrl, active: true });
      const responseUrl = await waitForTabRedirect(tab.id, returnTo);
      const steamId = await verifyOpenIdResponse(responseUrl);
      const apiKey = await fetchOrRegisterApiKey(tab.id);
      return { steamId, apiKey };
    } finally {
      if (tab && tab.id != null) {
        await chrome.tabs.remove(tab.id).catch(() => {});
      }
    }
  }

  global.TMSteamOpenId = { signInWithSteamOpenId };
})(typeof self !== 'undefined' ? self : this);

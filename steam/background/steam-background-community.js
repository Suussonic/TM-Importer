/**
 * steam/steam-background-community.js
 *
 * Acces aux pages publiques steamcommunity.com (scraping XML/HTML) depuis le
 * service worker, seul endroit qui echappe aux restrictions CORS de la page
 * hote. Sert aussi a lire/enregistrer automatiquement la cle Steam Web API
 * du compte connecte (steamcommunity.com/dev/apikey), reutilisee par
 * steam-background.js pour tous les appels JSON officiels.
 */
(function (global) {
  'use strict';

  const ALLOWED_TEXT_HOST = 'steamcommunity.com';

  /** Verifie qu'une URL cible bien steamcommunity.com (evite un proxy ouvert). */
  function assertAllowedCommunityUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      throw new Error('URL invalide.');
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_TEXT_HOST) {
      throw new Error('URL non autorisée.');
    }
  }

  /** Recupere le contenu texte (XML/HTML) d'une page publique steamcommunity.com. */
  async function fetchSteamCommunityText(url) {
    assertAllowedCommunityUrl(url);
    const res = await fetch(url, { credentials: 'include' });

    // Sans session valide, ces pages redirigent vers /login/... (HTML) au
    // lieu de renvoyer un 401 : a detecter explicitement sinon le HTML de
    // connexion atterrit tel quel dans le parseur XML cote content script.
    if (res.redirected && /\/login(\/|$)/.test(new URL(res.url).pathname)) {
      throw new Error(
        'Session Steam expirée ou introuvable : reconnectez-vous à Steam (carte de connexion en haut de la fenêtre) puis relancez le chargement.'
      );
    }

    if (!res.ok) {
      if (res.status === 401) {
        const path = new URL(res.url || url).pathname;
        // Le compte connecte peut lire son PROPRE profil (page /my/) mais se
        // voit refuser (401) les jeux/succes d'un AUTRE profil des que celui-ci
        // a "Details du jeu" regle sur Amis uniquement/Prive, meme si le
        // profil global est public. Non contournable par l'extension.
        if (/\/(games|stats)\//.test(path)) {
          throw new Error(
            "Steam refuse l'acces (HTTP 401) : le compte connecte n'est probablement pas autorise a voir les jeux/succes de ce profil. Le parametre de confidentialite \"Details du jeu\" de ce compte Steam n'est sans doute pas regle sur Public (verifiable sur steamcommunity.com/.../edit/settings)."
          );
        }
        throw new Error(
          "Steam refuse l'acces (HTTP 401) a cette requete : la session Steam de l'extension a probablement expire ou Steam bloque cette requete automatisee. Reconnectez-vous a Steam (carte de connexion en haut de la fenetre) puis reessayez."
        );
      }
      throw new Error(`Erreur réseau Steam (HTTP ${res.status}).`);
    }
    return res.text();
  }

  /** Attend qu'un onglet ait termine sa navigation. */
  function waitForTabComplete(tabId) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error('Steam ne répond pas dans le délai imparti.'));
      }, 20000);
      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  }

  /** Extrait la cle Steam Web API deja enregistree depuis le HTML de steamcommunity.com/dev/apikey. */
  function extractApiKeyFromHtml(html) {
    const match = html.match(/Key:\s*([0-9A-F]{32})/i);
    return match ? match[1] : null;
  }

  /** Extrait le jeton anti-CSRF (`g_sessionID`) requis pour enregistrer une nouvelle cle. */
  function extractSessionIdFromHtml(html) {
    const match = html.match(/g_sessionID\s*=\s*"([a-f0-9]+)"/i);
    return match ? match[1] : null;
  }

  /**
   * Lit (en l'enregistrant automatiquement si besoin) la cle Steam Web API
   * du compte connecte dans `tabId`, via steamcommunity.com/dev/apikey.
   * Cette page n'est accessible qu'en etant connecte : elle est lue depuis
   * le meme onglet que celui utilise pour la connexion OpenID.
   */
  async function fetchOrRegisterApiKey(tabId) {
    await chrome.tabs.update(tabId, { url: 'https://steamcommunity.com/dev/apikey?l=english' });
    await waitForTabComplete(tabId);

    const readKeyPage = async () => {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          const res = await fetch(location.href, { credentials: 'include' });
          return res.text();
        }
      });
      return (results[0] && results[0].result) || '';
    };

    let html = await readKeyPage();
    let apiKey = extractApiKeyFromHtml(html);
    if (apiKey) return apiKey;

    const sessionId = extractSessionIdFromHtml(html);
    if (!sessionId) {
      throw new Error("Impossible d'obtenir automatiquement une clé Steam Web API (steamcommunity.com/dev/apikey inaccessible).");
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sid) => {
        const body = new URLSearchParams({
          domain: 'localhost',
          agreeToTerms: 'agreed',
          sessionid: sid,
          Submit: 'Register'
        });
        await fetch('https://steamcommunity.com/dev/registerkey', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        });
      },
      args: [sessionId]
    });

    html = await readKeyPage();
    apiKey = extractApiKeyFromHtml(html);
    if (!apiKey) {
      throw new Error("Impossible d'enregistrer automatiquement une clé Steam Web API. Créez-en une manuellement sur steamcommunity.com/dev/apikey.");
    }
    return apiKey;
  }

  global.TMSteamCommunity = { fetchSteamCommunityText, fetchOrRegisterApiKey };
})(typeof self !== 'undefined' ? self : this);

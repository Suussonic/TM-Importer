/**
 * steam/steam-client-network.js
 *
 * Communication bas niveau avec le service worker (steam-background.js) et
 * parsing des reponses XML publiques de steamcommunity.com. Un content
 * script herite des restrictions CORS de la page hote (tiermaker.com), d'ou
 * le passage systematique par le service worker pour toute requete reseau.
 */
(function (global) {
  'use strict';

  const STEAM_ID64_REGEX = /^\d{17}$/;

  function sendMessageToBackground(type, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          if (chrome.runtime.lastError) {
            const message = chrome.runtime.lastError.message;
            resolve({ error: message, contextInvalidated: /Extension context invalidated/i.test(message) });
            return;
          }
          resolve(response || {});
        });
      } catch (err) {
        const message = err.message || String(err);
        resolve({ error: message, contextInvalidated: /Extension context invalidated/i.test(message) });
      }
    });
  }

  async function fetchSteamText(url) {
    const response = await sendMessageToBackground('FETCH_TEXT', { url });
    if (response.error) throw new Error(response.error);
    return response.text;
  }

  async function callSteamWebApi(method, params) {
    const response = await sendMessageToBackground('STEAM_API_REQUEST', { method, params });
    if (response.error) throw new Error(response.error);
    return response.data;
  }

  /** Construit l'URL d'une page profil Steam, acceptant un SteamID64 ou une vanity URL. */
  function buildProfileUrl(idOrVanity, suffix = '') {
    const base = STEAM_ID64_REGEX.test(idOrVanity)
      ? `https://steamcommunity.com/profiles/${idOrVanity}`
      : `https://steamcommunity.com/id/${encodeURIComponent(idOrVanity)}`;
    return `${base}${suffix}`;
  }

  /** Supprime les caracteres illegaux en XML 1.0 (frequents dans les pseudos Steam stylises). */
  function stripIllegalXmlChars(text) {
    return text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '');
  }

  /** Detecte une reponse HTML (page de connexion/limite d'age/anti-bot) au lieu du XML attendu. */
  function looksLikeHtml(text) {
    return /<!doctype html/i.test(text) || /<html[\s>]/i.test(text);
  }

  /** Parse une reponse XML Steam (`?xml=1`) en Document, avec repli si des caracteres illegaux la corrompent. */
  function parseSteamXml(text) {
    let doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) {
      const cleaned = stripIllegalXmlChars(text);
      doc = cleaned !== text ? new DOMParser().parseFromString(cleaned, 'text/xml') : doc;
    }
    if (doc.querySelector('parsererror')) {
      if (looksLikeHtml(text)) {
        throw new Error(
          "Steam a renvoyé une page web au lieu du profil demandé (profil limité par l'âge, ou requêtes temporairement limitées par Steam). Réessayez dans quelques instants."
        );
      }
      throw new Error('Réponse Steam invalide (XML illisible).');
    }
    return doc;
  }

  /** Lit le texte d'un element enfant d'un noeud XML (chaine vide si absent). */
  function readXmlNodeText(node, selector) {
    const el = node.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  /** Extrait un message d'erreur ou de confidentialite eventuel d'une reponse XML Steam. */
  function readXmlError(doc) {
    return readXmlNodeText(doc, 'error') || readXmlNodeText(doc, 'privacyMessage');
  }

  /** Vrai si l'erreur correspond a une limitation de debit Steam temporaire (retry utile apres un delai). */
  function isRateLimitError(err) {
    return /HTTP 429|limite de debit|trop de requetes/i.test((err && err.message) || '');
  }

  global.TMSteamNetwork = {
    STEAM_ID64_REGEX,
    sendMessageToBackground,
    fetchSteamText,
    callSteamWebApi,
    buildProfileUrl,
    parseSteamXml,
    readXmlNodeText,
    readXmlError,
    isRateLimitError
  };
})(typeof window !== 'undefined' ? window : this);

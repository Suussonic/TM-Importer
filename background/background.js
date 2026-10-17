/**
 * background/background.js
 *
 * Routeur générique de messages du service worker. Ce fichier ne connaît
 * rien de spécifique à Steam : il se contente de fusionner les handlers
 * exposés par chaque module "source" (voir `steam/background/steam-background.js`)
 * et de les dispatcher. Toute la logique propre à Steam (réseau, OpenID,
 * jaquettes) vit dans `steam/background/`, pour garder ce routeur réutilisable
 * si d'autres sources d'import sont ajoutées un jour.
 */

importScripts(
  '../steam/background/steam-background-community.js',
  '../steam/background/steam-background-openid.js',
  '../steam/background/steam-background-images.js',
  '../steam/background/steam-background.js'
);
importScripts(
  '../youtube/background/youtube-background-page.js',
  '../youtube/background/youtube-background-scrape.js',
  '../youtube/background/youtube-background-images.js',
  '../youtube/background/youtube-background.js'
);

const handlers = {
  ...self.TMSteamBackground.handlers,
  ...self.TMYouTubeBackground.handlers
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message && handlers[message.type];
  if (!handler) {
    sendResponse({ error: 'Type de message inconnu: ' + (message && message.type) });
    return false;
  }

  handler(message.payload || {}, sender)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ error: err.message || String(err) }));

  return true; // garde le canal ouvert pour la réponse asynchrone
});

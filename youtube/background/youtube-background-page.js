(function (global) {
  'use strict';

  function waitForPage(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('La page YouTube ne repond pas.')), 30000);
      function finish(error) {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(updated);
        chrome.tabs.onRemoved.removeListener(removed);
        if (error) reject(error);
        else resolve();
      }
      function updated(id, change) {
        if (id === tabId && change.status === 'complete') finish();
      }
      function removed(id) {
        if (id === tabId) finish(new Error('Onglet YouTube ferme pendant la lecture.'));
      }
      chrome.tabs.onUpdated.addListener(updated);
      chrome.tabs.onRemoved.addListener(removed);
      chrome.tabs.get(tabId).then((tab) => {
        if (tab.status === 'complete') finish();
      }, finish);
    });
  }

  async function browse({ url, client, continuation }) {
    const pageUrl = new URL(url, 'https://www.youtube.com');
    if (pageUrl.origin !== 'https://www.youtube.com' ||
        !/^\/(?:@[^/]+|channel\/[\w-]+|user\/[^/]+|c\/[^/]+)\/(?:videos|shorts|streams)$/.test(pageUrl.pathname) &&
        pageUrl.pathname !== '/playlist') {
      throw new Error('Page de pagination YouTube non autorisee.');
    }
    const tab = await chrome.tabs.create({ url: pageUrl.toString(), active: false });
    try {
      await waitForPage(tab.id);
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        // Le monde principal donne a fetch l'origine du site, et non celle
        // de l'extension, refusee par YouTube sur ses requetes POST.
        world: 'MAIN',
        func: async (publicClient, token) => {
          if (location.origin !== 'https://www.youtube.com') {
            return { error: 'YouTube demande un consentement. Ouvrez youtube.com et choisissez Accepter ou Refuser les cookies.' };
          }
          try {
            const response = await fetch('/youtubei/v1/browse?prettyPrint=false', {
              method: 'POST',
              credentials: 'omit',
              headers: {
                'Content-Type': 'application/json',
                'X-Youtube-Client-Name': '1',
                'X-Youtube-Client-Version': publicClient.clientVersion,
                ...(publicClient.visitorData ? { 'X-Goog-Visitor-Id': publicClient.visitorData } : {})
              },
              body: JSON.stringify({ context: { client: publicClient }, continuation: token }),
              signal: AbortSignal.timeout(25000)
            });
            if (!response.ok) return { error: `Pagination depuis YouTube refusee (HTTP ${response.status}). Le cache precedent est conserve.` };
            return { data: await response.json() };
          } catch (error) {
            return { error: `Lecture depuis la page YouTube impossible : ${error.message || error}` };
          }
        },
        args: [client, continuation]
      });
      const result = results[0] && results[0].result;
      if (!result) throw new Error('La page YouTube ne renvoie aucune donnee de pagination.');
      if (result.error) throw new Error(result.error);
      return result.data;
    } finally {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (error) {
        console.warn('[TM Importer] Fermeture de l\'onglet YouTube :', error.message || error);
      }
    }
  }

  global.TMYouTubePage = { browse };
})(typeof self !== 'undefined' ? self : this);

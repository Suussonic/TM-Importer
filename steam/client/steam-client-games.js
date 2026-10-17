/**
 * steam/steam-client-games.js
 *
 * Liste des jeux possedes et detection de la completion a 100% des succes.
 *
 * `isGameFullyCompleted` tente jusqu'a 3 chemins avant d'abandonner :
 * GetPlayerAchievements, puis GetUserStatsForGame (autre endpoint officiel,
 * meme reponse, reussit parfois la ou le premier echoue avec un 500), puis
 * en dernier recours le scraping cible de la page de stats de CE seul jeu.
 * Les erreurs de limite de debit (429) ne passent pas par ces replis : elles
 * remontent immediatement pour laisser `scanCompletedGames` gerer le retry
 * avec backoff, seul endroit qui sait qu'un scan de masse est en cours.
 */
(function (global) {
  'use strict';

  const { callSteamWebApi, fetchSteamText, buildProfileUrl, parseSteamXml, readXmlNodeText, readXmlError, isRateLimitError } =
    global.TMSteamNetwork;

  const SCAN_CONCURRENCY = 3;

  /** Recupere la liste des jeux possedes par un utilisateur (IPlayerService/GetOwnedGames). */
  async function getOwnedGames(steamId) {
    const data = await callSteamWebApi('IPlayerService/GetOwnedGames/v0001/', {
      steamid: steamId,
      include_appinfo: 1,
      include_played_free_games: 1,
      // Exclus par defaut par Steam alors que la page "Tous les jeux" les
      // affiche : jeux gratuits du "free sub" et apps non verifiees.
      include_free_sub: 1,
      skip_unvetted_apps: 0
    });
    const response = data && data.response;
    // Profil dont "Details du jeu" n'est pas public : Steam renvoie un objet
    // vide (HTTP 200) au lieu d'une erreur, ce qui donnerait silencieusement
    // 0 jeu au lieu d'un message explicite.
    if (!response || (response.games === undefined && response.game_count === undefined)) {
      throw new Error(
        'Steam ne renvoie aucun jeu pour ce compte : le parametre de confidentialite "Details du jeu" doit etre regle sur Public.'
      );
    }
    const games = response.games || [];
    return games.map((game) => ({
      appid: Number(game.appid),
      name: game.name || String(game.appid),
      hoursOnRecord: Number(game.playtime_forever) || 0,
      iconUrl: game.img_icon_url
        ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
        : ''
    }));
  }

  /** Appelle un endpoint officiel de succes et calcule la completion (tolerant au typage de "achieved"). */
  async function checkAchievementsViaMethod(method, steamId, appid) {
    const data = await callSteamWebApi(method, { steamid: steamId, appid, l: 'english' });
    const playerstats = data && data.playerstats;
    // Une reponse sans `playerstats` ou avec success:false et un message autre
    // que "pas de stats" est une erreur : ne pas la confondre avec "jeu sans
    // succes", sinon un jeu termine est silencieusement ecarte.
    if (!playerstats) throw new Error('Reponse Steam Web API invalide (playerstats manquant).');
    if (playerstats.success === false && playerstats.error) throw new Error(playerstats.error);
    const achievements = playerstats.achievements;
    if (!Array.isArray(achievements) || achievements.length === 0) return null;
    return achievements.every((achievement) => Number(achievement.achieved) === 1);
  }

  /**
   * Dernier repli quand les deux endpoints API officiels echouent pour un
   * jeu precis : scrape la page de stats de CE jeu (requete ciblee, sans
   * risque de blocage anti-bot contrairement a un scraping en masse).
   * Le schema exact n'est pas garanti : plusieurs marqueurs de deverrouillage
   * possibles sont verifies avant d'abandonner (erreur explicite plutot que
   * de deviner un resultat potentiellement faux).
   */
  async function checkAchievementsViaScraping(steamId, appid) {
    const url = `${buildProfileUrl(steamId)}/stats/${appid}/?xml=1`;
    const xml = await fetchSteamText(url);
    const doc = parseSteamXml(xml);

    const errorMessage = readXmlError(doc);
    if (errorMessage) throw new Error(errorMessage);

    const achievementNodes = Array.from(doc.querySelectorAll('achievements > achievement'));
    if (achievementNodes.length === 0) {
      throw new Error('Page de stats Steam illisible (aucun succes trouve).');
    }

    return achievementNodes.every((node) => {
      const closed = readXmlNodeText(node, 'closed');
      const achieved = readXmlNodeText(node, 'achieved');
      const unlocktimeText = readXmlNodeText(node, 'unlocktime');
      if (closed !== '') return closed === '1';
      if (achieved !== '') return achieved === '1';
      if (unlocktimeText !== '') return Number(unlocktimeText) > 0;
      console.warn('[TM Importer] Structure de succes non reconnue pour', appid, node.outerHTML);
      throw new Error('Structure de la page de stats Steam non reconnue.');
    });
  }

  /**
   * Determine si un jeu est termine a 100%. Retourne `null` uniquement pour
   * les cas legitimes (jeu sans succes, stats privees/indisponibles), jamais
   * pour une erreur reseau/serveur qui doit rester visible a l'appelant.
   */
  async function isGameFullyCompleted(steamId, appid) {
    try {
      return await checkAchievementsViaMethod('ISteamUserStats/GetPlayerAchievements/v0001/', steamId, appid);
    } catch (err) {
      if (/does not have stats|no stats|not public|private/i.test(err.message || '')) return null;
      if (isRateLimitError(err)) throw err;
      try {
        return await checkAchievementsViaMethod('ISteamUserStats/GetUserStatsForGame/v0002/', steamId, appid);
      } catch (fallbackErr) {
        if (/does not have stats|no stats|not public|private/i.test(fallbackErr.message || '')) return null;
        if (isRateLimitError(fallbackErr)) throw fallbackErr;
        try {
          return await checkAchievementsViaScraping(steamId, appid);
        } catch (scrapeErr) {
          throw err;
        }
      }
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Execute `worker` sur chaque element de `items` avec au maximum `limit` executions simultanees. */
  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runNext() {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        try {
          results[currentIndex] = await worker(items[currentIndex], currentIndex);
        } catch (err) {
          results[currentIndex] = null;
        }
      }
    }

    const runnerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: runnerCount }, runNext));
    return results;
  }

  /** Erreurs temporaires (serveur Steam surcharge, coupure reseau) : un nouvel essai a de bonnes chances de reussir. */
  function isTransientError(err) {
    return /Internal Server Error|HTTP 5\d\d|Failed to fetch|NetworkError|Load failed/i.test((err && err.message) || '');
  }

  // Pause partagee entre tous les workers : des qu'un worker subit une limite
  // de debit, les autres cessent aussi d'envoyer des requetes, sinon chacun
  // continue de marteler Steam et epuise ses essais pour rien.
  let pausedUntil = 0;

  async function waitForGlobalPause() {
    const remaining = pausedUntil - Date.now();
    if (remaining > 0) await delay(remaining);
  }

  /**
   * Re-essaie `isGameFullyCompleted` avec un backoff croissant sur les
   * limitations de debit (429, jusqu'a 6 essais) et les erreurs temporaires
   * du serveur (jusqu'a 3 essais). Un jeu n'est declare "non verifie" qu'apres
   * epuisement de ces essais.
   */
  async function checkGameCompletionWithRetry(steamId, appid) {
    const MAX_RATE_LIMIT_RETRIES = 6;
    const MAX_TRANSIENT_RETRIES = 3;
    let rateLimitRetries = 0;
    let transientRetries = 0;

    for (;;) {
      await waitForGlobalPause();
      try {
        return { isCompleted: await isGameFullyCompleted(steamId, appid) };
      } catch (err) {
        if (isRateLimitError(err) && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          const backoffMs = 1500 * Math.pow(2, rateLimitRetries++);
          pausedUntil = Math.max(pausedUntil, Date.now() + backoffMs);
          continue;
        }
        if (!isRateLimitError(err) && isTransientError(err) && transientRetries < MAX_TRANSIENT_RETRIES) {
          await delay(500 * Math.pow(2, transientRetries++));
          continue;
        }
        return { error: err };
      }
    }
  }

  /**
   * Recoupement via IPlayerService/GetAchievementsProgress, l'endpoint qui
   * alimente l'onglet "Obtenus" de steamcommunity.com (100 jeux par requete).
   * Retourne l'ensemble des appids que Steam declare 100% termines ; vide si
   * l'endpoint est indisponible (le scan jeu par jeu reste alors la reference).
   */
  async function getPerfectAppIdsFromProgress(steamId, appids) {
    const perfect = new Set();
    for (let i = 0; i < appids.length; i += 100) {
      const params = { steamid: steamId, language: 'english' };
      appids.slice(i, i + 100).forEach((appid, index) => {
        params[`appids[${index}]`] = appid;
      });
      try {
        const data = await callSteamWebApi('IPlayerService/GetAchievementsProgress/v1/', params);
        const entries = (data && data.response && data.response.achievement_progress) || [];
        entries.forEach((entry) => {
          const total = Number(entry.total) || 0;
          if (entry.all_unlocked === true || (total > 0 && Number(entry.unlocked) === total)) {
            perfect.add(Number(entry.appid));
          }
        });
      } catch (err) {
        console.warn('[TM Importer] GetAchievementsProgress indisponible :', err.message || err);
      }
    }
    return perfect;
  }

  /**
   * Scanne les jeux possedes par un utilisateur et retourne ceux
   * correspondant au filtre demande :
   *  - '100' (defaut) : jeux termines a 100%, verifies un par un (lent, peut
   *    echouer/rate-limit). TOUS les jeux possedes sont verifies (pas
   *    seulement ceux avec du temps de jeu enregistre) car certains jeux
   *    sont a 100% avec `playtime_forever` a 0.
   *  - 'owned' : toute la bibliotheque, sans verification.
   *  - 'played' : jeux avec du temps de jeu enregistre, sans verification.
   * Un jeu dont la verification echoue est liste dans `failed` plutot que
   * silencieusement compte comme non termine.
   */
  async function scanCompletedGames(steamId, options = {}) {
    const { onProgress, concurrency = SCAN_CONCURRENCY, filterMode = '100' } = options;

    const allGames = await getOwnedGames(steamId);
    const playedGames = allGames.filter((game) => game.hoursOnRecord > 0);

    if (filterMode === 'owned' || filterMode === 'played') {
      const games = filterMode === 'owned' ? allGames : playedGames;
      if (onProgress) onProgress(games.length, games.length);
      return {
        completed: games.map((game) => ({ appid: game.appid, name: game.name, iconUrl: game.iconUrl })),
        failed: [],
        totalOwned: allGames.length,
        totalPlayed: playedGames.length
      };
    }

    let checkedCount = 0;
    const completed = [];
    const failed = [];

    await mapWithConcurrency(allGames, concurrency, async (game) => {
      const result = await checkGameCompletionWithRetry(steamId, game.appid);
      checkedCount++;
      if (onProgress) onProgress(checkedCount, allGames.length);

      if (result.error) {
        failed.push({ appid: game.appid, name: game.name, message: result.error.message || String(result.error) });
        return;
      }
      if (result.isCompleted === true) {
        completed.push({ appid: game.appid, name: game.name, iconUrl: game.iconUrl });
      }
    });

    // Un jeu que Steam declare 100% mais que le scan n'a pas retenu (echec ou
    // reponse incomplete) est ajoute et retire des "non verifies".
    const perfectAppIds = await getPerfectAppIdsFromProgress(steamId, allGames.map((game) => game.appid));
    const completedIds = new Set(completed.map((game) => game.appid));
    allGames.forEach((game) => {
      if (!perfectAppIds.has(game.appid) || completedIds.has(game.appid)) return;
      completed.push({ appid: game.appid, name: game.name, iconUrl: game.iconUrl });
      const failedIndex = failed.findIndex((item) => item.appid === game.appid);
      if (failedIndex !== -1) failed.splice(failedIndex, 1);
    });

    completed.sort((a, b) => a.name.localeCompare(b.name));
    return { completed, failed, totalOwned: allGames.length, totalPlayed: playedGames.length };
  }

  global.TMSteamGames = { getOwnedGames, isGameFullyCompleted, scanCompletedGames };
})(typeof window !== 'undefined' ? window : this);

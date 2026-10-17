/**
 * steam/steam-client-profile.js
 *
 * Resolution de profil Steam (SteamID64 ou pseudo) et recherche
 * d'utilisateurs par pseudo.
 *
 * `resolveProfile` utilise la Steam Web API officielle des qu'une cle est
 * disponible (auto-obtenue a la connexion OpenID) car ces appels
 * serveur-a-serveur ne sont pas bloques (HTTP 401) par les protections
 * anti-bot de Steam, contrairement au scraping des pages `?xml=1`. Ce
 * scraping ne sert plus que de repli avant toute connexion OpenID.
 *
 * `searchUsers` reste un scraping de la page publique de recherche (aucune
 * API officielle equivalente), avec repli vers `resolveProfile` si l'entree
 * saisie est exactement l'URL personnalisee du profil.
 */
(function (global) {
  'use strict';

  const {
    STEAM_ID64_REGEX,
    fetchSteamText,
    callSteamWebApi,
    buildProfileUrl,
    parseSteamXml,
    readXmlNodeText,
    readXmlError
  } = global.TMSteamNetwork;

  /** Resout un profil via la Steam Web API officielle (ResolveVanityURL + GetPlayerSummaries). */
  async function resolveProfileViaApi(idOrVanity) {
    let steamId = idOrVanity;
    if (!STEAM_ID64_REGEX.test(idOrVanity)) {
      const resolved = await callSteamWebApi('ISteamUser/ResolveVanityURL/v0001/', { vanityurl: idOrVanity });
      const result = resolved && resolved.response;
      if (!result || result.success !== 1 || !result.steamid) {
        throw new Error('Utilisateur Steam introuvable.');
      }
      steamId = result.steamid;
    }

    const summaries = await callSteamWebApi('ISteamUser/GetPlayerSummaries/v0002/', { steamids: steamId });
    const player = summaries && summaries.response && summaries.response.players && summaries.response.players[0];
    if (!player) {
      throw new Error('Utilisateur Steam introuvable.');
    }
    // communityvisibilitystate === 3 signifie "Public" (1 = prive, 2 = amis uniquement).
    if (player.communityvisibilitystate !== 3) {
      throw new Error('Ce profil Steam est privé. Impossible de récupérer ses jeux.');
    }

    return {
      steamId: player.steamid,
      personaname: player.personaname || player.steamid,
      avatar: player.avatarfull || player.avatarmedium || player.avatar || ''
    };
  }

  /** Repli utilise uniquement avant toute connexion OpenID (pas encore de cle Steam Web API). */
  async function resolveProfileViaScraping(idOrVanity) {
    const url = buildProfileUrl(idOrVanity, '?xml=1');
    const xml = await fetchSteamText(url);
    const doc = parseSteamXml(xml);

    const errorMessage = readXmlError(doc);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    const steamId = readXmlNodeText(doc, 'steamID64');
    if (!steamId) {
      throw new Error('Utilisateur Steam introuvable.');
    }

    const privacyState = readXmlNodeText(doc, 'privacyState');
    if (privacyState && privacyState !== 'public') {
      throw new Error('Ce profil Steam est privé. Impossible de récupérer ses jeux.');
    }

    return {
      steamId,
      personaname: readXmlNodeText(doc, 'steamID') || steamId,
      avatar: readXmlNodeText(doc, 'avatarFull')
    };
  }

  /**
   * Resout un profil Steam (SteamID64 ou vanity URL) : Steam Web API en
   * priorite, scraping `?xml=1` uniquement si aucune cle n'est encore
   * enregistree (jamais connecte via OpenID).
   */
  async function resolveProfile(idOrVanity) {
    try {
      return await resolveProfileViaApi(idOrVanity);
    } catch (err) {
      if (/Connectez-vous avec Steam/.test(err.message || '')) {
        return resolveProfileViaScraping(idOrVanity);
      }
      throw err;
    }
  }

  /** Extrait un SteamID64 ou une vanity URL depuis un lien de profil Steam. */
  function extractIdOrVanityFromProfileUrl(href) {
    const idMatch = href.match(/\/profiles\/(\d+)/);
    if (idMatch) return idMatch[1];
    const vanityMatch = href.match(/\/id\/([^/?]+)/);
    if (vanityMatch) return decodeURIComponent(vanityMatch[1]);
    return null;
  }

  /** Recherche des utilisateurs Steam par pseudo via la page de recherche publique de la communaute. */
  async function searchUsers(query) {
    const url = `https://steamcommunity.com/search/SearchCommunityAjax?text=${encodeURIComponent(query)}&filter=users`;
    const html = await fetchSteamText(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const links = Array.from(doc.querySelectorAll('a[href*="/id/"], a[href*="/profiles/"]'));
    const results = [];
    const seenHrefs = new Set();

    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href || seenHrefs.has(href)) return;
      seenHrefs.add(href);

      const idOrVanity = extractIdOrVanityFromProfileUrl(href);
      if (!idOrVanity) return;

      const avatarImg = link.querySelector('img');
      const nameEl = link.querySelector('.searchPersonaName') || link;
      const name = (nameEl.textContent || '').trim() || idOrVanity;

      results.push({ id: idOrVanity, name, avatar: avatarImg ? avatarImg.src : '' });
    });

    return results.slice(0, 8);
  }

  global.TMSteamProfile = { resolveProfile, searchUsers };
})(typeof window !== 'undefined' ? window : this);

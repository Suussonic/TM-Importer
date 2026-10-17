/**
 * steam/steam-background-images.js
 *
 * Telechargement des jaquettes de jeux Steam (CDN) depuis le service worker.
 *
 * Les jeux recents exigent un segment de hash dans l'URL de l'asset (ex:
 * .../<hash>/header.jpg), obtenu via l'API interne IStoreBrowseService
 * (publique, sans cle). Seuls hero_blur et logo restent accessibles sans
 * hash (logo est en outre un asset optionnel, absent pour certains jeux).
 */
(function (global) {
  'use strict';

  const ALLOWED_IMAGE_HOSTS = [
    'cdn.akamai.steamstatic.com',
    'cdn.cloudflare.steamstatic.com',
    'shared.akamai.steamstatic.com',
    'shared.cloudflare.steamstatic.com',
    'media.steampowered.com'
  ];

  const STEAM_STORE_ASSETS_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';

  /** Correspondance entre nos types d'image et les cles d'assets IStoreBrowseService. */
  const STORE_ASSET_KEY_BY_TYPE = {
    header: 'header',
    capsule: 'library_capsule',
    hero: 'library_hero'
  };

  /** Nom de fichier CDN (sans hash) associe a chaque type d'image demande. */
  const IMAGE_FILENAME_BY_TYPE = {
    header: 'header.jpg',
    capsule: 'library_600x900.jpg',
    hero: 'library_hero.jpg',
    hero_blur: 'library_hero_blur.jpg',
    logo: 'logo.png'
  };

  /** Recupere les chemins d'assets (avec hash) d'un jeu via l'API interne IStoreBrowseService. */
  async function fetchStoreItemAssets(appId) {
    try {
      const body = {
        ids: [{ appid: Number(appId) }],
        context: { language: 'english', country_code: 'US', steam_realm: 1 },
        data_request: { include_assets: true }
      };
      const url = new URL('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/');
      url.searchParams.set('input_json', JSON.stringify(body));
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const data = await res.json();
      const item = data.response && data.response.store_items && data.response.store_items[0];
      return (item && item.assets) || null;
    } catch (err) {
      return null;
    }
  }

  /** Construit l'URL complete d'un asset depuis le gabarit "asset_url_format" + le nom de fichier hache. */
  function buildStoreAssetUrl(assets, filenameKey) {
    if (!assets || !assets.asset_url_format || !assets[filenameKey]) return null;
    return STEAM_STORE_ASSETS_BASE + assets.asset_url_format.replace('${FILENAME}', assets[filenameKey]);
  }

  /** Liste (ordonnee) des URLs CDN Steam candidates sans hash pour une jaquette donnee. */
  function getSteamImageUrlCandidates(appId, type) {
    const filename = IMAGE_FILENAME_BY_TYPE[type] || IMAGE_FILENAME_BY_TYPE.header;
    return [
      `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/${filename}`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/${filename}`
    ];
  }

  /** Verifie qu'une URL d'image cible bien un domaine CDN Steam autorise. */
  function assertAllowedImageUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      throw new Error("URL d'image invalide.");
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.includes(parsed.hostname)) {
      throw new Error("URL d'image non autorisée.");
    }
  }

  /** Convertit un Blob en dataURL base64 (FileReader n'existe pas dans un service worker). */
  async function blobToDataUrl(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
  }

  /**
   * Telecharge une jaquette Steam et la renvoie en base64. Pour 'icon',
   * l'URL exacte (hash) doit etre fournie par l'appelant (elle vient des
   * jeux possedes cote API, non reconstructible depuis le seul appid). Pour
   * header/capsule/hero, l'URL hachee est d'abord recuperee via
   * IStoreBrowseService (obligatoire pour les jeux recents), avec repli sur
   * les chemins CDN sans hash. Pour hero_blur/logo, seuls les chemins sans
   * hash sont essayes.
   */
  async function fetchGameImageDataUrl(appid, type, directUrl) {
    if (type === 'icon') {
      if (!directUrl) throw new Error("Icône indisponible pour ce jeu (relancez un rechargement).");
      assertAllowedImageUrl(directUrl);
      const res = await fetch(directUrl);
      if (!res.ok) {
        throw new Error("Jaquette introuvable pour ce jeu et ce type d'image.");
      }
      return blobToDataUrl(await res.blob());
    }

    if (!/^\d+$/.test(String(appid))) {
      throw new Error('Identifiant de jeu invalide.');
    }

    const candidates = [];
    const assetKey = STORE_ASSET_KEY_BY_TYPE[type];
    if (assetKey) {
      const assets = await fetchStoreItemAssets(appid);
      const hashedUrl = buildStoreAssetUrl(assets, assetKey);
      if (hashedUrl) candidates.push(hashedUrl);
    }
    candidates.push(...getSteamImageUrlCandidates(appid, type));

    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          return blobToDataUrl(await res.blob());
        }
      } catch (err) {
        // Essaie l'URL candidate suivante.
      }
    }
    throw new Error("Jaquette introuvable pour ce jeu et ce type d'image.");
  }

  global.TMSteamImages = {
    fetchGameImageDataUrl,
    getSteamImageUrl: (appId, type) => getSteamImageUrlCandidates(appId, type)[0]
  };
})(typeof self !== 'undefined' ? self : this);

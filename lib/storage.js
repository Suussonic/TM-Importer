/**
 * lib/storage.js
 *
 * Wrapper autour de `chrome.storage.local` centralisant tout le cache de
 * l'extension :
 *   - les utilisateurs Steam déjà recherchés (plusieurs comptes possibles)
 *   - les listes de jeux terminés à 100% par utilisateur
 *   - les images de jaquettes déjà téléchargées (par appid + type)
 *   - les réglages généraux (clé API Steam, type d'image sélectionné, ...)
 *
 * Ce fichier est chargé en tant que script classique (pas de module ES) afin
 * d'être utilisable tel quel dans un content script.
 */
(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    USERS: 'tm_users',
    GAMES: 'tm_games',
    IMAGES: 'tm_images',
    SETTINGS: 'tm_settings',
    YOUTUBE_USERS: 'tm_youtube_users',
    YOUTUBE_ITEMS: 'tm_youtube_items',
    LETTERBOXD_PROFILES: 'tm_letterboxd_profiles',
    LETTERBOXD_CATALOGS: 'tm_letterboxd_catalogs'
  };

  function isStorageAvailable() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function getImageStorageKey(source, itemId, type) {
    return `tm_img:${source}:${itemId}:${type}`;
  }

  /**
   * Lit une clé du storage local et retourne toujours un objet (jamais undefined).
   * @param {string} key
   */
  function readObject(key) {
    return new Promise((resolve, reject) => {
      if (!isStorageAvailable()) {
        reject(new Error('Stockage local du navigateur indisponible.'));
        return;
      }

      try {
        chrome.storage.local.get(key, (result) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(result[key] || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Ecrit une valeur dans le storage local.
   * @param {string} key
   * @param {*} value
   */
  function writeObject(key, value) {
    return new Promise((resolve, reject) => {
      if (!isStorageAvailable()) {
        reject(new Error('Stockage local du navigateur indisponible.'));
        return;
      }

      try {
        chrome.storage.local.set({ [key]: value }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  const TMStorage = {
    KEYS: STORAGE_KEYS,

    // ---- Utilisateurs Steam enregistrés ----------------------------------

    /** Retourne tous les utilisateurs Steam enregistrés, indexés par steamId64. */
    async getUsers() {
      return readObject(STORAGE_KEYS.USERS);
    },

    /** Enregistre/actualise un utilisateur Steam (fusion des champs). */
    async saveUser(steamId, data) {
      const users = await readObject(STORAGE_KEYS.USERS);
      users[steamId] = { ...users[steamId], ...data };
      await writeObject(STORAGE_KEYS.USERS, users);
      return users[steamId];
    },

    /** Supprime un utilisateur enregistré ainsi que son cache de jeux. */
    async removeUser(steamId) {
      const users = await readObject(STORAGE_KEYS.USERS);
      delete users[steamId];
      await writeObject(STORAGE_KEYS.USERS, users);

      const games = await readObject(STORAGE_KEYS.GAMES);
      delete games[steamId];
      await writeObject(STORAGE_KEYS.GAMES, games);
    },

    // ---- Jeux terminés à 100% par utilisateur -----------------------------

    /** Retourne les données de scan mises en cache pour un utilisateur (ou null). */
    async getGamesForUser(steamId) {
      const games = await readObject(STORAGE_KEYS.GAMES);
      return games[steamId] || null;
    },

    /**
     * Sauvegarde le résultat d'un scan pour un utilisateur.
     * @param {string} steamId
     * @param {{completed: Array<{appid:number,name:string}>, totalOwned:number, lastFetched:number}} data
     */
    async saveGamesForUser(steamId, data) {
      const games = await readObject(STORAGE_KEYS.GAMES);
      games[steamId] = data;
      await writeObject(STORAGE_KEYS.GAMES, games);
    },

    // ---- Chaines / playlists YouTube enregistrees ------------------------

    async getYouTubeUsers() {
      return readObject(STORAGE_KEYS.YOUTUBE_USERS);
    },

    async saveYouTubeUser(userId, data) {
      const users = await readObject(STORAGE_KEYS.YOUTUBE_USERS);
      users[userId] = { ...users[userId], ...data };
      await writeObject(STORAGE_KEYS.YOUTUBE_USERS, users);
      return users[userId];
    },

    async removeYouTubeUser(userId) {
      const users = await readObject(STORAGE_KEYS.YOUTUBE_USERS);
      delete users[userId];
      await writeObject(STORAGE_KEYS.YOUTUBE_USERS, users);

      const items = await readObject(STORAGE_KEYS.YOUTUBE_ITEMS);
      delete items[userId];
      await writeObject(STORAGE_KEYS.YOUTUBE_ITEMS, items);
    },

    async getYouTubeItemsForUser(userId) {
      const items = await readObject(STORAGE_KEYS.YOUTUBE_ITEMS);
      return items[userId] || null;
    },

    async saveYouTubeItemsForUser(userId, data) {
      const items = await readObject(STORAGE_KEYS.YOUTUBE_ITEMS);
      items[userId] = data;
      await writeObject(STORAGE_KEYS.YOUTUBE_ITEMS, items);
    },

    // ---- Comptes et realisateurs Letterboxd -------------------------------

    async getLetterboxdProfiles() {
      return readObject(STORAGE_KEYS.LETTERBOXD_PROFILES);
    },

    async saveLetterboxdProfile(profileId, profile) {
      const profiles = await readObject(STORAGE_KEYS.LETTERBOXD_PROFILES);
      profiles[profileId] = { ...profiles[profileId], ...profile };
      await writeObject(STORAGE_KEYS.LETTERBOXD_PROFILES, profiles);
      return profiles[profileId];
    },

    async removeLetterboxdProfile(profileId) {
      const profiles = await readObject(STORAGE_KEYS.LETTERBOXD_PROFILES);
      delete profiles[profileId];
      await writeObject(STORAGE_KEYS.LETTERBOXD_PROFILES, profiles);
      const catalogs = await readObject(STORAGE_KEYS.LETTERBOXD_CATALOGS);
      delete catalogs[profileId];
      await writeObject(STORAGE_KEYS.LETTERBOXD_CATALOGS, catalogs);
    },

    async getLetterboxdCatalog(profileId) {
      const catalogs = await readObject(STORAGE_KEYS.LETTERBOXD_CATALOGS);
      return catalogs[profileId] || null;
    },

    async saveLetterboxdCatalog(profileId, data) {
      const catalogs = await readObject(STORAGE_KEYS.LETTERBOXD_CATALOGS);
      catalogs[profileId] = data;
      await writeObject(STORAGE_KEYS.LETTERBOXD_CATALOGS, catalogs);
    },

    // ---- Cache des images de jaquettes -------------------------------------
    // Une cle de storage par image : evite de relire/reecrire tout le cache
    // (potentiellement des dizaines de Mo) a chaque image telechargee. L'ancien
    // objet unique `tm_images` reste lu en repli pour les images deja en cache.

    /** Retourne l'image (dataURL base64) mise en cache pour un jeu/type donné. */
    async getImage(appId, type) {
      return this.getSourceImage('steam', appId, type);
    },

    /** Met en cache une image (dataURL base64) pour un jeu/type donné. */
    async saveImage(appId, type, dataUrl) {
      await this.saveSourceImage('steam', appId, type, dataUrl);
    },

    async getSourceImage(source, itemId, type) {
      const imageKey = getImageStorageKey(source, itemId, type);
      const single = await readObject(imageKey);
      if (typeof single === 'string') return single;

      const legacyImages = await readObject(STORAGE_KEYS.IMAGES);
      const legacyKey = source === 'steam' ? itemId : `${source}:${itemId}`;
      return (legacyImages[legacyKey] && legacyImages[legacyKey][type]) || null;
    },

    async saveSourceImage(source, itemId, type, dataUrl) {
      await writeObject(getImageStorageKey(source, itemId, type), dataUrl);
    },

    // ---- Réglages généraux --------------------------------------------------

    /** Retourne les réglages généraux de l'extension (clé API, etc). */
    async getSettings() {
      return readObject(STORAGE_KEYS.SETTINGS);
    },

    /** Fusionne et sauvegarde de nouveaux réglages généraux. */
    async saveSettings(partialSettings) {
      const current = await readObject(STORAGE_KEYS.SETTINGS);
      const merged = { ...current, ...partialSettings };
      await writeObject(STORAGE_KEYS.SETTINGS, merged);
      return merged;
    }
  };

  global.TMStorage = TMStorage;
})(typeof self !== 'undefined' ? self : this);

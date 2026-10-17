# TM Importer

Extension Chrome (Manifest V3) qui importe des jaquettes/miniatures dans TierMaker :

- **Steam** : jeux terminés à 100 %, possédés ou joués, avec connexion Steam OpenID.
- **YouTube** : miniatures des vidéos de chaînes et playlists publiques, par lecture des pages YouTube, **sans connexion Google ni clé API**.

## Installation

1. Ouvrir `chrome://extensions` et activer le **mode développeur**.
2. Choisir **Charger l'extension non empaquetée** et sélectionner ce dossier.
3. Ouvrir TierMaker : le bouton **Importer depuis un compte** apparaît sous le champ d'ajout d'images.

Après une mise à jour, **recharger l'extension et rafraîchir l'onglet TierMaker** pour mettre à jour les scripts et permissions.

Les menus **Source** et **Jeux** partagent la même présentation. Les flèches du clavier parcourent les choix, Entrée/Espace sélectionnent et Échap ferme le menu. Un seul menu s'ouvre à la fois ; son placement s'adapte à l'espace de l'écran.

## YouTube : utilisation sans API Google

1. Sélectionner la source **YouTube**.
2. Cliquer sur **Ajouter une chaîne ou playlist**.
3. Coller un `@handle`, une URL de chaîne ou une URL de playlist et enregistrer la source.
   La recherche démarre automatiquement après une courte pause de saisie, comme pour Steam.
4. Cliquer sur **Recharger** sur la ligne enregistrée pour lire le catalogue public.
5. Choisir les filtres puis cliquer sur **Importer**.

Les chaînes et playlists déjà enregistrées restent utilisables. Recharger leur catalogue pour remplacer les anciennes données de l'API.

### Fonctionnement et limites

- Le service worker lit les données structurées intégrées dans le HTML de YouTube, sans exécuter les scripts du site.
- Pour une chaîne, il parcourt les onglets **Vidéos**, **Shorts** et **En direct** disponibles. Le format Shorts vient de l'onglet, pas d'une supposition fondée sur la durée.
- Les pages suivantes sont chargées via les requêtes de continuation du **site web YouTube** (`youtubei/v1/browse`), sans clé ni jeton Google. Ce ne sont pas des appels à la YouTube Data API v3. Le catalogue n'est pas limité à la première page.
- Les vidéos sont dédupliquées par identifiant. Une erreur de pagination empêche d'enregistrer un catalogue partiel et conserve le cache précédent.
- Les dates affichées dans les listes étant souvent relatives, un **filtre par date** lit chaque page vidéo pour récupérer sa date exacte. C'est plus lent ; les dates récupérées sont conservées dans le cache. Une date inaccessible provoque une erreur explicite au lieu d'un filtrage approximatif.
- Dans les **playlists**, YouTube ne précise pas systématiquement si une vidéo est un Short. Si le type est inconnu, un filtre exclusif Vidéos/Shorts est refusé : laisser les deux cases cochées ou utiliser une chaîne.
- Aucune connexion Google n'est demandée. La lecture HTML réutilise les cookies YouTube du navigateur, notamment le choix de consentement existant. Si un consentement est requis, ouvrir YouTube dans le même navigateur, accepter ou refuser les cookies, puis relancer la recherche. L'extension ne choisit pas à votre place.
- Les requêtes de pagination restent anonymes, sans cookies de compte Google : les requêtes authentifiées du site nécessitent une signature de session que l'extension ne génère pas. Une erreur HTTP précise l'étape en échec et conserve le catalogue précédent. Le journal permet de relancer individuellement le chargement d'un catalogue YouTube.
- Si YouTube refuse l'origine de l'extension (HTTP 403), la pagination est exécutée depuis un **onglet YouTube temporaire en arrière-plan**, fermé après la requête même en cas d'erreur. Cela utilise l'origine du site sans falsifier d'en-tête ni ajouter de connexion Google. Un éventuel consentement ou blocage de YouTube reste signalé.
- Les contenus privés, supprimés, réservés aux membres, restreints par âge ou par région peuvent être absents ou inaccessibles.
- Aucun contournement de consentement, de connexion ou de protection anti-robot. Si YouTube bloque les requêtes (HTTP 429, consentement, etc.), l'erreur est affichée. Réessayer plus tard.
- Le HTML et les requêtes internes de YouTube peuvent changer : cette méthode n'a pas la stabilité d'une API officielle.
- Les miniatures sont téléchargées avec repli vers d'autres résolutions si nécessaire, puis mises en cache localement.

## Steam

La connexion passe par le fournisseur OpenID officiel Steam et obtient une clé Web API pour lire la bibliothèque et les succès. Le profil et ses **Détails du jeu** doivent être publics.

Le filtre **100 %** vérifie les succès des jeux, avec replis et nouvelles tentatives pour les erreurs temporaires. Les jeux non vérifiés sont signalés dans les logs et peuvent être ajoutés manuellement. Les filtres **Possédé** et **Joué** ne vérifient pas les succès.

## Structure

```text
manifest.json          Permissions, scripts et service worker
background/            Routeur des messages
content/               Interface TierMaker, filtres et import
lib/                   Stockage et icônes
steam/                 Client et service worker Steam
youtube/background/    Lecture des pages publiques, pagination et miniatures
youtube/client/        Messages, catalogue et filtrage YouTube
public/                Images de l'extension
tests/                 Tests Node.js sans dépendance externe
```

## Tests

Avec Node.js installé :

```powershell
node --test tests\dropdown.test.cjs tests\youtube.test.cjs
```

Les tests utilisent des réponses simulées : aucune connexion Google ni donnée de compte nécessaire.

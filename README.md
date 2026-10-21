# TM Importer 1.1.0

Extension Chrome (Manifest V3) qui importe des jaquettes/miniatures dans TierMaker :

- **Steam** : jeux terminés à 100 %, possédés ou joués, avec connexion Steam OpenID.
- **YouTube** : miniatures des vidéos de chaînes et playlists publiques, par lecture des pages YouTube, **sans connexion Google ni clé API**.
- **Letterboxd** : affiches des films de comptes et réalisateurs enregistrés, par lecture des **pages publiques**.

## Installation

1. Ouvrir `chrome://extensions` et activer le **mode développeur**.
2. Choisir **Charger l'extension non empaquetée** et sélectionner ce dossier.
3. Ouvrir TierMaker : le bouton **Importer depuis un compte** apparaît sous le champ d'ajout d'images.

Après une mise à jour, **recharger l'extension et rafraîchir l'onglet TierMaker** pour mettre à jour les scripts et permissions.

Les menus **Source** et **Jeux** partagent la même présentation. Les flèches du clavier parcourent les choix, Entrée/Espace sélectionnent et Échap ferme le menu. Un seul menu s'ouvre à la fois ; son placement s'adapte à l'espace de l'écran.

## Letterboxd :

L'API officielle Letterboxd nécessite un accès développeur autorisé. Cette intégration utilise donc les pages publiques, **pas l'API officielle**.

### Comptes et réalisateurs

1. Sélectionner **Letterboxd**, puis **Ajouter un compte ou réalisateur**.
2. Choisir le type de source et saisir :
   - le **pseudo exact** d'un compte, ou l'URL de son profil ;
   - l'identifiant d'un réalisateur, par exemple `christopher-nolan`, son nom correspondant à cet identifiant, ou, de préférence, l'URL `https://letterboxd.com/director/christopher-nolan/`.
3. La saisie vérifie la page publique après une courte pause ; sélectionner le résultat ou cliquer sur **Enregistrer**. Ce n'est pas une recherche approximative parmi tous les membres ou cinéastes : pour un nom ambigu, utiliser l'URL exacte.
4. Ouvrir **Filtres Letterboxd**, choisir le catalogue, puis **Recharger** sur la source enregistrée.
5. Ajuster les filtres puis cliquer sur **Importer** pour envoyer les affiches à TierMaker.

Plusieurs comptes et réalisateurs peuvent être conservés indépendamment. Leur catalogue, les réglages et la date du dernier chargement sont enregistrés localement. Supprimer une source supprime son catalogue, pas les autres comptes ni les affiches partagées en cache.

### Catalogues et filtres

| Paramètre | Choix |
|---|---|
| Catalogue d'un compte | Vus, aimés, notés, films avec critique publiée, watchlist |
| Réalisateur enregistré | Filmographie publique, indépendamment du catalogue de compte sélectionné |
| Note personnelle | Tous, notés, sans note ; minimum et maximum de 0,5 à 5, par demi-étoile |
| Like personnel | Tous, aimés uniquement, non aimés uniquement |
| Sortie | Année minimale et maximale |
| Durée | Minimum et maximum en minutes |
| Note moyenne Letterboxd | Minimum et maximum sur 5 |
| Texte et métadonnées | Titre, genres, pays, langues, réalisateur, acteur/actrice |
| Tri | Ordre du catalogue, titre, année, note personnelle, note moyenne ou durée ; ordre croissant/décroissant |
| Limite d'import | Nombre entier facultatif ; vide = tous les résultats, sans plafond arbitraire |

Les filtres se combinent par **ET**. Dans les champs genres, pays, langues, réalisateur et acteur, les valeurs séparées par des virgules sont des alternatives (**OU**). La recherche textuelle ignore la casse et les accents. Pour les métadonnées, utiliser les libellés de Letterboxd, généralement anglais (`Drama`, `France`, `French` ; les codes de langues du JSON-LD sont également acceptés).

Les filtres sont regroupés en sections **Compte**, **Films**, **Détails** et **Import**. Le choix du catalogue nécessite un **nouveau rechargement** : l'extension refuse d'importer une ancienne sélection avec un autre catalogue. Les autres filtres s'appliquent à l'import ; leurs réglages sont conservés. **Réinitialiser** restaure les valeurs par défaut.

Les avatars des comptes et portraits des réalisateurs sont récupérés depuis leur page publique (les portraits peuvent provenir du CDN TMDB indiqué par Letterboxd, sans clé API). Pour les sources déjà enregistrées sans image, cliquer sur **Recharger** actualise aussi leur avatar. Si aucun portrait public n'est fourni, l'emplacement reste neutre.

Les notes et likes personnels ne sont pas disponibles pour la filmographie d'un réalisateur ou la watchlist : leur utilisation sur ces sources est refusée explicitement. Les films « avec critique » correspondent aux critiques publiées par le compte, **pas aux commentaires sous les critiques d'autres membres**. Pour les critiques, la note et le like sont ceux de l'entrée publique ; si plusieurs critiques concernent le même film, la première rencontrée dans l'ordre du site fournit ces valeurs, et une seule affiche est importée.

### Fonctionnement et limites

- La pagination parcourt toutes les pages publiques accessibles, puis déduplique les films. Un échec ou une pagination répétée ne remplace pas le cache par un catalogue partiel.
- Le catalogue et sa pagination sont lus dans le contenu principal de la page : les aperçus d'affiches des fenêtres de saisie Letterboxd sont ignorés, même lorsqu'ils précèdent la liste des films.
- Les affiches verticales viennent des données structurées **JSON-LD** des fiches films, pas de l'image de fond ni des placeholders de la grille. Les URL de redimensionnement du CDN Letterboxd sont demandées en **1000 × 1500 pixels** au minimum, sans agrandissement artificiel local (la netteté reste limitée par l'original). Les filtres de durée/métadonnées nécessitent de lire les fiches et sont donc plus lents. Les détails lus pour filtrer sont conservés jusqu'au prochain rechargement du catalogue.
- Les lectures successives des pages de catalogue et de détails sont espacées. Les requêtes ont un délai maximal et ne relancent pas automatiquement les refus HTTP.
- Les profils privés, réactions masquées, brouillons et contenus non publics ne sont pas accessibles. Seules les notes et réactions effectivement publiques sont prises en compte.
- Les limites HTTP **403/429**, pages de connexion, protections anti-robot et changements de HTML sont signalés dans l'interface et le journal. Aucun contournement n'est effectué. Certains accès ont effectivement renvoyé HTTP 403 lors du développement : le fonctionnement en ligne dépend des autorisations du site depuis le navigateur.
- Une donnée requise par un filtre mais absente ne donne pas un résultat approximatif : l'import signale une erreur. Une zone de réactions présente mais sans note signifie « non noté publiquement » ; si toute la zone est absente, la note ou le like reste inconnu et les filtres personnels concernés sont refusés. Les valeurs manquantes lors d'un tri sont placées en dernier, sauf une note personnelle inconnue qui empêche ce tri.
- Les affiches réussies sont mises en cache localement. L'ancien cache d'affiches est ignoré lors du premier import haute résolution ; il n'est pas nécessaire de supprimer les comptes ni de recharger les catalogues. Réimporter les affiches pour remplacer les anciennes images déjà placées dans TierMaker.
- Les affiches importées depuis Letterboxd s'affichent dans des cases de **100 × 150 pixels**, sans recadrage, dans la réserve et les rangs TierMaker. Les images des autres sources ne sont pas modifiées. Les imports échoués peuvent être relancés individuellement ou en lot ; les erreurs de catalogue disposent également d'un bouton de relance.
- Les erreurs du stockage local sont propagées au lieu de faire croire qu'une sauvegarde a réussi.

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
letterboxd/background/ Lecture des pages publiques et téléchargement des affiches
letterboxd/client/     Parsing HTML/JSON-LD, pagination et filtres Letterboxd
letterboxd/content/    Contrôles et actions Letterboxd dans la fenêtre d'import
letterboxd/styles/     Présentation des paramètres Letterboxd
public/                Images de l'extension
tests/                 Tests Node.js (DOM simulé par linkedom pour Letterboxd)
```

## Tests

Avec une version récente de Node.js et npm installés :

```powershell
npm ci
npm test
```

Les tests utilisent des réponses simulées : aucune connexion Google/Letterboxd ni donnée de compte nécessaire. `linkedom` est une dépendance de développement pour tester le parsing DOM ; l'extension elle-même ne nécessite aucune compilation ni dépendance npm à l'exécution.

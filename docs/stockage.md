# Stockage des photos (CDN)

Les photos de la galerie sont publiées par les membres depuis l'espace membre (Galerie). Le serveur ne garde **jamais** le fichier reçu : il le contrôle, le réencode en WebP et en fait deux versions, puis les enregistre sur un service de stockage distant (CDN) — ou, **en dev uniquement**, sur le disque du poste.

## Parcours d'une photo
1. **Réception** (`server/src/routes/gallery.ts`) : membre validé, 10 photos maximum par membre toutes les 10 minutes, 15 Mo maximum, une seule photo par envoi. Les photos sont traitées **une à la fois** (le traitement d'une photo de 25 Mpx occupe ~210 Mo ; deux en parallèle dépasseraient la mémoire du conteneur) : un envoi simultané attend son tour quelques secondes.
2. **Contrôle du contenu réel** (pas seulement l'extension) : jpg, png ou webp ; ni GIF ni image animée, ni HEIC (le serveur ne sait pas le décoder ; un iPhone envoie de lui-même un JPEG, la page n'annonçant pas ce format) ; 25 mégapixels maximum (au-delà, le décodage demanderait trop de mémoire au conteneur).
3. **Réencodage** : une grande version (1 800 px maximum, WebP qualité 84) et une miniature (600 px, qualité 78). L'orientation du téléphone est appliquée, les métadonnées (position GPS…) disparaissent.
4. **Enregistrement** (`server/src/storage.ts`) des deux fichiers, puis de leur adresse publique en base.

La miniature sert au bandeau de l'accueil et aux listes ; la grande version n'est téléchargée que si l'on ouvre la photo.

## Deux modes
| | CDN (production) | Disque local (dev uniquement) |
|---|---|---|
| Réglage `.env` | `STORAGE_URL`, `STORAGE_TOKEN` et `STORAGE_PREFIX` remplis | `STORAGE_URL` et `STORAGE_TOKEN` vides |
| Emplacement | Service de stockage distant, sous le dossier `STORAGE_PREFIX` | `uploads/` à la racine du dépôt, sur le poste |
| Adresse publique | Celle renvoyée par le service | `/uploads/galerie/<id>.webp`, servie par le site |
| Sauvegarde | Assurée par le service | Aucune (poste de dev) |

**En production (`NODE_ENV=production`, c'est-à-dire l'image Docker), le CDN est obligatoire** : sans `STORAGE_URL` / `STORAGE_TOKEN`, le site démarre, la galerie reste visible, mais tout envoi est refusé (« L'envoi de photos n'est pas encore configuré sur ce site ») et un avertissement apparaît au démarrage. Le disque du VPS n'est ni sauvegardé ni fait pour garder les photos.

Les deux variables vont ensemble (une seule remplie bloque le démarrage). Des photos plus anciennes restées sur le disque (volume Docker `uploads`, d'avant le CDN) gardent leur adresse et restent servies par le site.

**Un préfixe par site** : plusieurs sites peuvent partager le même service de stockage, chacun dans son dossier (`STORAGE_PREFIX=monsite/`). Ne jamais réutiliser le préfixe d'un autre site.

## Contrat attendu du service de stockage
Le site parle au service par deux requêtes HTTP, authentifiées par `Authorization: Bearer <STORAGE_TOKEN>` :

| Requête | Effet attendu | Réponse attendue |
|---|---|---|
| `PUT <STORAGE_URL>/api/object/<STORAGE_PREFIX><clé>` avec l'image en corps (`Content-Type: image/webp`) | Enregistre le fichier | `2xx` et un JSON `{ "url": "<adresse publique du fichier>" }` |
| `DELETE <STORAGE_URL>/api/object/<STORAGE_PREFIX><clé>` | Supprime le fichier | `2xx` (un `404` est accepté : fichier déjà absent) |

La clé ressemble à `galerie/lz3k9p2a-1f2e3d4c.webp` (et `…-t.webp` pour la miniature). Délai maximal d'une requête : 30 s. Si le service ne répond pas à l'envoi, le membre voit « Le stockage des images ne répond pas » et rien n'est enregistré en base.

L'adresse publique renvoyée doit être sur le même domaine que `STORAGE_URL` : la politique de sécurité du site (`Content-Security-Policy`, `server/src/security.ts`) n'autorise l'affichage d'images que depuis le site lui-même, Discord (avatars) et l'origine de `STORAGE_URL`.

## Retrait d'une photo
L'auteur ou un membre avec les droits de Gestion retire la photo : elle disparaît du site immédiatement (marquée supprimée en base), puis ses deux fichiers sont effacés du stockage. Si le stockage échoue à ce moment, la ligne de la photo reste 7 jours en base et la purge quotidienne (`server/src/purge.ts`) redemande la suppression des fichiers avant de l'effacer ; tant que le stockage échoue, la ligne est gardée.

La suppression d'un compte (Administration, ou par la personne elle-même) retire d'abord du stockage les fichiers de toutes ses photos, puis le compte. Si le stockage ne répond pas, rien n'est supprimé (`503`) : on réessaie plus tard, et aucun fichier ne reste en ligne sans compte.

Le service doit renvoyer une adresse publique sur l'origine de `STORAGE_URL` : une autre est refusée à l'envoi (la photo ne s'afficherait pas, la politique de sécurité ne l'autorisant pas). Retirer `STORAGE_URL`/`STORAGE_TOKEN` alors que des photos y sont encore : leur retrait échoue (et leurs lignes sont gardées) jusqu'à ce que le stockage soit de nouveau configuré.

## Auteur affiché
Pour les visiteurs de la vitrine, `GET /api/gallery` ne donne que le nom RP et le grade de l'auteur. Le pseudo Discord, l'avatar et l'identifiant ne sont renvoyés qu'à un membre connecté.

## Photos d'exemple
Les six images de `assets/exemples/` ne passent **jamais** par le stockage : ce sont des fichiers du projet, affichés par `galerie.js` tant qu'aucune vraie photo n'existe.

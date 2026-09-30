# Stockage des photos (CDN)

Les photos de la galerie sont publiées par les membres depuis l'espace membre (Galerie). Le serveur ne garde **jamais** le fichier reçu : il le contrôle, le réencode en WebP et en fait deux versions, puis les enregistre soit sur un service de stockage distant (CDN), soit sur le disque du serveur.

## Parcours d'une photo
1. **Réception** (`server/src/routes/gallery.ts`) : membre validé, 10 photos maximum par membre toutes les 10 minutes, 15 Mo maximum, une seule photo par envoi.
2. **Contrôle du contenu réel** (pas seulement l'extension) : jpg, png, webp ou heic ; ni GIF ni image animée ; 25 mégapixels maximum (au-delà, le décodage demanderait trop de mémoire au conteneur).
3. **Réencodage** : une grande version (1 800 px maximum, WebP qualité 84) et une miniature (600 px, qualité 78). L'orientation du téléphone est appliquée, les métadonnées (position GPS…) disparaissent.
4. **Enregistrement** (`server/src/storage.ts`) des deux fichiers, puis de leur adresse publique en base.

La miniature sert au bandeau de l'accueil et aux listes ; la grande version n'est téléchargée que si l'on ouvre la photo.

## Deux modes
| | Disque local (défaut) | CDN |
|---|---|---|
| Réglage `.env` | `STORAGE_URL` et `STORAGE_TOKEN` vides | `STORAGE_URL`, `STORAGE_TOKEN` et `STORAGE_PREFIX` remplis |
| Emplacement | Dev : `uploads/` à la racine du dépôt. Prod : volume Docker `uploads` du site | Service de stockage distant, sous le dossier `STORAGE_PREFIX` |
| Adresse publique | `/uploads/galerie/<id>.webp`, servie par le site | Celle renvoyée par le service |
| Sauvegarde | Pas incluse dans les sauvegardes de la base : à sauvegarder à part (volume Docker) | Assurée par le service |

Le mode se choisit au démarrage (les deux variables vont ensemble ; une seule remplie bloque le démarrage). Passer du disque au CDN en cours de route ne casse rien : les photos déjà enregistrées gardent leur adresse locale et restent servies par le site ; seules les nouvelles partent sur le CDN.

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
L'auteur ou un membre avec les droits de Gestion retire la photo : elle disparaît du site immédiatement (marquée supprimée en base), puis ses deux fichiers sont effacés du stockage. Si le stockage échoue à ce moment, il reste seulement un fichier orphelin, sans effet sur le site.

## Photos d'exemple
Les six images de `assets/exemples/` ne passent **jamais** par le stockage : ce sont des fichiers du projet, affichés par `galerie.js` tant qu'aucune vraie photo n'existe.

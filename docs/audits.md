# Prompts d'audit

Une revue généraliste (« est-ce prêt pour la prod ? ») trouve surtout un type de problème et passe à côté des autres. Ces prompts découpent l'audit en **angles indépendants**, à lancer séparément avant une mise en prod, après une grosse fonctionnalité, ou périodiquement.

Dans Claude Code : `/audit` lance les cinq angles en parallèle et fusionne les rapports, `/audit <angle>` un seul (voir `.claude/skills/audit/`). Ce fichier est la seule source des prompts : les modifier ici suffit.

Fichier mutualisé : on l'améliore dans le modèle, chaque site le récupère avec le reste de la partie gestion.

## Format de sortie commun

À ajouter à la fin de chaque prompt :

```
Lis CLAUDE.md et docs/api.md avant de commencer : les règles qui y figurent sont des décisions déjà prises, ne les remets pas en cause et ne signale pas comme défaut un comportement qui y est documenté comme volontaire.

Pour chaque problème trouvé :
- fichier:ligne
- scénario concret de défaillance (quelles entrées / quel état → quel résultat faux, crash ou fuite)
- correction proposée
- gravité : Indispensable avant prod / Fortement conseillé / Mineur

Classe les problèmes par gravité. Ne signale rien que tu n'as pas vérifié dans le code. N'écris aucune modification : rapport uniquement, en français.
```

## 1. Accès et sessions (serveur)

```
Audite uniquement le contrôle d'accès du serveur (server/src).
Cherche :
- toute route /api ou /auth sans garde (member, admin, manager de server/src/http.ts) ou avec une garde plus faible que celle annoncée dans docs/api.md ;
- les vérifications « auteur ou gestion » (photos, messages du chat) contournables en changeant un identifiant dans l'adresse ou le corps ;
- l'escalade de droits : un membre qui se donne un grade, modifie un grade supérieur au sien, ou garde ses droits après retrait d'un rôle Discord ; le propriétaire du serveur revérifié à chaque connexion ;
- la connexion Discord : paramètre state, appartenance au serveur vérifiée, session régénérée à la connexion, comptes en attente ou refusés qui accèdent quand même à des données ;
- DEV_LOGIN activable en production, ou tout autre raccourci de dev qui survit en prod ;
- les requêtes qui modifient des données (POST, PATCH, DELETE) déclenchables depuis un autre site (CSRF : SameSite, Content-Type, vérification d'origine) ;
- les limites de requêtes contournables (clé de limitation, confiance au proxy).
```

## 2. Navigateur (XSS, CSP, fichiers servis)

```
Audite uniquement ce qui s'exécute ou s'affiche dans le navigateur, et ce que le serveur expose comme fichiers.
Cherche :
- toute donnée venant d'un utilisateur, de Discord ou du bot (nom RP, bio, légende de photo, message du chat, pseudo, nom d'item, note de taxe) insérée par innerHTML, insertAdjacentHTML ou dans un attribut sans échappement, dans espace/*.html, espace/espace.js, galerie.js, org.js et les autres scripts ;
- les URL construites depuis une donnée utilisateur (href, src) qui accepteraient javascript: ou une autre origine ;
- la CSP (server/src/security.ts) : directives trop larges, nonce réutilisé ou prévisible, ressource externe chargée sans y être déclarée ;
- les {{…}} placés dans une chaîne JavaScript (piège documenté dans CLAUDE.md) et l'échappement des valeurs de site.json dans site.ts ;
- les fichiers servis : vérifie que server/, site.json, compose*.yaml, .env, docs/, uploads/ hors photos publiques restent inaccessibles, y compris via encodage (%2e%2e, double slash, majuscules) ;
- les données sensibles renvoyées au navigateur sans besoin (jeton du bot, identifiants internes, champs de profil d'autres membres sur des routes publiques).
```

## 3. Relais du bot Discord

```
Audite uniquement le relais de l'API du bot (server/src/routes/bot.ts et les pages qui l'appellent).
Cherche :
- la liaison (POST /api/bot/link) : le jeton doit appartenir au membre connecté ET au serveur Discord du site ; rejeu d'un jeton d'un autre membre ou d'un autre serveur ;
- le jeton : jamais renvoyé au navigateur, jamais écrit dans un log, oublié quand le bot répond 401 ou à la déconnexion ;
- la liste blanche des rubriques : sortie possible de /api/<rubrique> (.., encodage, double slash, query string détournée) vers une autre route du bot ;
- le cache par membre : une réponse d'un membre servie à un autre, clé de cache incomplète (paramètres de requête, identifiant), données d'un admin servies à un non-admin ;
- la charge : pages qui appellent le bot sans passer par espaceBot.get() ou plus souvent que toutes les 5 minutes, risque de dépasser les 300 requêtes par quart d'heure du bot pour tout le site ;
- le contrat avec l'API du bot : compare les adresses et les champs lus par les pages au code du bot (dépôt https://github.com/poulpizar01/roxwood-network-famille, dossier src/api/ et section API de son README) ; signale toute route ou tout champ utilisé qui n'existe plus ou a changé de forme ;
- le comportement quand le bot est lent, coupé ou répond une erreur : page bloquée, erreur affichée, nouvelle tentative en boucle.
```

## 4. Fiabilité, ressources et déploiement

```
Audite uniquement la fiabilité en exploitation et la consommation de ressources.
Cherche :
- les erreurs non attrapées qui arrêtent le serveur (routes async, flux SSE, traitement d'image, appels au stockage ou au bot) ;
- la mémoire : traitement d'image (sharp) par rapport au plafond du conteneur, caches en mémoire sans borne (cache du bot, flux SSE, listes de membres), fuites de connexions SSE ;
- l'envoi de photos : taille, mégapixels, type réel du fichier (pas seulement l'extension), fichiers orphelins sur le stockage après une erreur ou une suppression ;
- la base : tables qui grossissent sans fin (sessions, messages du chat, lus/non lus), requêtes sans index sur des colonnes filtrées, migrations non commitées ;
- le démarrage : variables d'environnement manquantes ou invalides détectées tôt avec un message clair, ou erreur obscure plus tard ;
- le déploiement : compose.yaml (limites mémoire, redémarrage, ports publiés en loopback, sauvegardes réellement restaurables), nginx (docs/nginx.md, en-têtes transmis, flux SSE), cookies Secure derrière le proxy.
```

## 5. Modèle mutualisé et pièges du projet

```
Vérifie uniquement le respect des règles propres à ce modèle, décrites dans CLAUDE.md et README.md.
Cherche :
- dans les fichiers mutualisés (espace/, server/, org.js, main.js, 404.html, compose*.yaml, docs/, .claude/skills/) : contenu propre à un groupe (nom, lieu, vocabulaire), couleur de marque ou police en dur au lieu des variables de theme.css ;
- les pages de espace/ dont l'en-tête diffère des autres (meta application-name, ordre theme.css / styles.css / espace.css, barre de navigation, espace.js) ;
- les attributs onclick ou scripts insérés par innerHTML, inopérants sous la CSP ;
- les routes qui lisent req.session hors de /api et /auth ;
- les débordements horizontaux et le menu burger aux largeurs 375, 768, 1 024 et 1 280 px (lecture du CSS, sans navigateur : signale seulement les cas certains) ;
- une fonctionnalité ou une route ajoutée sans mise à jour de docs/api.md, README.md, server/README.md ou CLAUDE.md ;
- les commentaires qui racontent une modification passée au lieu de décrire l'invariant actuel.
```

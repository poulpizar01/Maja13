# nginx : exposer le site en HTTPS

Le conteneur du site n'écoute que sur `127.0.0.1:<HOST_PORT>` : il est invisible depuis Internet. **nginx**, installé sur la machine (hors Docker), reçoit les visiteurs sur les ports 80 et 443, gère le certificat HTTPS et transmet les requêtes au site. Un seul nginx sert tous les sites du VPS : un fichier de configuration par site.

```
Visiteur ──HTTPS 443──▶ nginx (VPS) ──HTTP──▶ 127.0.0.1:<HOST_PORT> ──▶ conteneur <SITE_ID>-app (port 3000)
```

## Mise en place
Modèle de configuration : [`server/deploy/nginx.conf.example`](../server/deploy/nginx.conf.example).
```bash
sudo cp server/deploy/nginx.conf.example /etc/nginx/sites-available/<SITE_ID>
sudo nano /etc/nginx/sites-available/<SITE_ID>          # remplacer __DOMAIN__ (domaine) et __PORT__ (HOST_PORT du .env)
sudo ln -s /etc/nginx/sites-available/<SITE_ID> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx            # nginx -t vérifie la syntaxe avant de recharger
sudo certbot --nginx -d <domaine>                      # ajoute le certificat, le bloc 443 et la redirection http → https
```
Prérequis de certbot : le domaine pointe déjà sur le VPS (`dig +short <domaine>`) et le port 80 est ouvert. Le certificat se renouvelle tout seul (tâche installée par certbot ; test : `sudo certbot renew --dry-run`).

## Ce que fait chaque réglage
| Réglage | Pourquoi |
|---|---|
| `client_max_body_size 16m` | Taille maximale d'une requête. Le site accepte des photos jusqu'à 15 Mo ; sans cette ligne, nginx refuse tout au-delà de 1 Mo (erreur 413). |
| `proxy_pass http://127.0.0.1:__PORT__` | Transmet la requête au conteneur du site. |
| `Host`, `X-Real-IP`, `X-Forwarded-For` | Donnent au site le vrai domaine et la vraie adresse IP du visiteur (le site fait confiance à un seul proxy : `trust proxy 1`). Sans eux, les limites de requêtes compteraient tous les visiteurs comme un seul. |
| `X-Forwarded-Proto` | Indique au site que le visiteur est en HTTPS. Indispensable : le cookie de session est marqué `Secure` et ne serait jamais envoyé sans cette information. |
| `location = /api/chat/stream` | Le chat reçoit les messages en direct par un flux (Server-Sent Events). `proxy_buffering off` les transmet immédiatement, `proxy_read_timeout 1h` évite une coupure toutes les 60 s, `Connection ''` garde la connexion ouverte. |

Ne pas ajouter de cache nginx sur les pages : elles sont personnalisées par site et par session. Les images de `assets/` portent déjà leur propre durée de cache (7 jours).

## Plusieurs sites sur le même VPS
Chaque site a son `SITE_ID`, son `HOST_PORT`, son domaine et son fichier dans `sites-available`. nginx choisit le site d'après le domaine demandé (`server_name`). Exemple : `famille-a` sur le port 3001 pour `a.exemple.fr`, `famille-b` sur 3002 pour `b.exemple.fr`.

## Dépannage
| Symptôme | Cause probable |
|---|---|
| `502 Bad Gateway` | Le conteneur est arrêté ou redémarre : `docker compose ps`, `docker logs <SITE_ID>-app`. Ou `__PORT__` ≠ `HOST_PORT`. |
| `413 Request Entity Too Large` à l'envoi d'une photo | `client_max_body_size` absent ou trop bas. |
| Connexion Discord qui « ne tient pas » (retour à la page de connexion) | Site testé en `http://`, ou `X-Forwarded-Proto` absent. |
| Le chat ne reçoit plus les messages en direct | Bloc `location = /api/chat/stream` absent. |
| Mauvais site affiché | `server_name` erroné, ou lien manquant dans `sites-enabled`. |

Journaux nginx : `/var/log/nginx/access.log` et `/var/log/nginx/error.log`.

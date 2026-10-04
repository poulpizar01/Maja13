# Image du site (contexte = racine du dépôt, voir compose.yaml)

# 1. construction : dépendances complètes, client Prisma, compilation TypeScript
FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# 2. exécution : dépendances de production, dépôt (site statique, schéma et migrations Prisma), code compilé
FROM node:22-alpine
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . /app
COPY --from=build /app/server/dist ./dist
# utilisateur sans privilèges ; seul le dossier des photos sur disque lui est inscriptible (dev ; en prod, aucun volume :
# les photos vont au stockage distant)
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
# applique les migrations en attente, puis démarre (exec : le serveur reçoit directement les signaux d'arrêt)
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]

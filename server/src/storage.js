/* La Maja 13 — stockage des fichiers envoyés (galerie)
   - avec STORAGE_URL + STORAGE_TOKEN : service de stockage distant (CDN), utilisé en production
   - sans : disque local (UPLOAD_DIR), servi par le site sous /uploads — environnement de dev */
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCAL_PREFIX = '/uploads/';

export function createStorage({ url, token, prefix, dir }) {
  if (!url !== !token) throw new Error('Stockage : STORAGE_URL et STORAGE_TOKEN vont ensemble (les deux, ou aucun pour le disque local)');
  mkdirSync(dir, { recursive: true });
  const base = (url || '').replace(/\/+$/, '');
  const objectUrl = key => `${base}/api/object/${key.split('/').map(encodeURIComponent).join('/')}`;
  const cdn = async (method, key, body, mimeType) => {
    const r = await fetch(objectUrl(prefix + key), { method, body, signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, ...(mimeType && { 'Content-Type': mimeType }) } });
    if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`stockage ${method} ${key} : HTTP ${r.status}`);
    return method === 'PUT' ? r.json() : null;
  };
  return {
    kind: token ? 'cdn' : 'local',
    // enregistre un fichier et renvoie son URL publique
    async put(key, data, mimeType) {
      if (token) return (await cdn('PUT', key, data, mimeType)).url;
      const file = join(dir, key);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
      return LOCAL_PREFIX + key;
    },
    // supprime un fichier d'après l'URL enregistrée : un fichier local reste local même une fois le CDN activé
    async remove(key, publicUrl) {
      if (publicUrl.startsWith(LOCAL_PREFIX)) { try { unlinkSync(join(dir, key)); } catch {} return; }
      if (token) await cdn('DELETE', key);
    },
  };
}

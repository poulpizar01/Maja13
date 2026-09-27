/* La Maja 13 — stockage des fichiers envoyés (galerie)
   - avec STORAGE_URL + STORAGE_TOKEN : service de stockage distant (CDN), utilisé en production
   - sans : disque local (UPLOAD_DIR), servi par le site sous /uploads — environnement de dev */
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const LOCAL_PREFIX = '/uploads/';
const { url, token, prefix, dir } = config.storage;
if (!url !== !token) throw new Error('Stockage : STORAGE_URL et STORAGE_TOKEN vont ensemble (les deux, ou aucun pour le disque local)');
mkdirSync(dir, { recursive: true });

const base = url.replace(/\/+$/, '');
const objectUrl = (key: string) => `${base}/api/object/${(prefix + key).split('/').map(encodeURIComponent).join('/')}`;
async function cdn(method: 'PUT' | 'DELETE', key: string, body?: Buffer, mimeType?: string) {
  const r = await fetch(objectUrl(key), {
    method, body: body && new Uint8Array(body), signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, ...(mimeType && { 'Content-Type': mimeType }) },
  });
  if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`stockage ${method} ${key} : HTTP ${r.status}`);
  return r;
}

// verrou : seules des images WebP (réencodées par La Casa) sont stockées — signature RIFF….WEBP et extension .webp
const isWebp = (key: string, data: Buffer) =>
  key.endsWith('.webp') && data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';

export const storage = {
  kind: token ? 'cdn' as const : 'local' as const,
  dir,
  // enregistre une image WebP et renvoie son URL publique
  async put(key: string, data: Buffer): Promise<string> {
    if (!isWebp(key, data)) throw new Error(`stockage : ${key} refusé (seules les images WebP sont acceptées)`);
    if (token) return ((await (await cdn('PUT', key, data, 'image/webp')).json()) as { url: string }).url;
    const file = join(dir, key);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    return LOCAL_PREFIX + key;
  },
  // supprime un fichier d'après l'URL enregistrée : un fichier local reste local même une fois le CDN activé
  async remove(key: string, publicUrl: string): Promise<void> {
    if (publicUrl.startsWith(LOCAL_PREFIX)) { try { unlinkSync(join(dir, key)); } catch { /* déjà absent */ } return; }
    if (token) await cdn('DELETE', key);
  },
};

// Galerie photo : lecture publique, dépôt par les membres validés, retrait par l'auteur ou la Gestion.
import crypto from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { prisma } from '../db.js';
import type { Photo } from '../generated/prisma/client.js';
import { body, intParam, member, text } from '../http.js';
import { author, authorFields } from '../members.js';
import { canAdmin } from '../ranks.js';
import { storage } from '../storage.js';
import { limits } from '../security.js';

export const gallery = Router();

// toujours servi : en dev c'est le stockage, en prod il sert les photos restées sur le disque
gallery.use('/uploads', express.static(storage.dir, { maxAge: '30d', immutable: true }));

// Images acceptées : photos fixes uniquement (pas de GIF ni d'image animée). Deux contrôles :
// 1. type annoncé par le navigateur (tri rapide, falsifiable) ; 2. format réel lu dans le contenu du fichier.
// Ce qui part ensuite au stockage est toujours un WebP réencodé ici, jamais le fichier reçu.
const FORMATS_ACCEPTES = ['jpeg', 'png', 'webp', 'heif'];   // heif = photos HEIC des téléphones
const MAX_PIXELS = 25_000_000;                               // garde-fou contre les images piégées (décompression géante)
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(f.mimetype)),
});
const receivePhoto: RequestHandler = (req, res, next) => upload.single('photo')(req, res, err => {
  if (err) res.status(400).json({ error: (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (15 Mo max)' : 'Fichier refusé' });
  else next();
});

// format réel du fichier : null si accepté, sinon le message de refus
async function refusImage(buffer: Buffer): Promise<string | null> {
  let meta: sharp.Metadata;
  try { meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata(); } catch { return 'Image illisible'; }
  if (!meta.format || !FORMATS_ACCEPTES.includes(meta.format)) return 'Format refusé : jpg, png, webp ou heic uniquement (pas de gif)';
  if ((meta.pages ?? 1) > 1) return 'Les images animées ne sont pas acceptées';
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS) return 'Image trop grande (25 mégapixels max)';
  return null;
}

const withAuthor = { member: authorFields } as const;
const photoView = (p: Photo & { member: Parameters<typeof author>[0] }) => ({
  id: p.id, url: p.url, thumb: p.thumbUrl, width: p.width, height: p.height, caption: p.caption, createdAt: p.createdAt, author: author(p.member),
});

gallery.get('/api/gallery', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const photos = await prisma.photo.findMany({ where: { deletedAt: null }, include: withAuthor, orderBy: { createdAt: 'desc' }, take: limit });
  res.json(photos.map(photoView));
});

gallery.post('/api/gallery', ...member, limits.upload, receivePhoto, async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'Aucune image (jpg, png, webp, heic — pas de gif)' }); return; }
  const refus = await refusImage(req.file.buffer);
  if (refus) { res.status(400).json({ error: refus }); return; }
  let big: { data: Buffer; info: sharp.OutputInfo }, thumb: Buffer;
  try {
    const img = sharp(req.file.buffer, { animated: false, limitInputPixels: MAX_PIXELS }).rotate();
    big = await img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
    thumb = await img.clone().resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  } catch (e) { console.error(e); res.status(400).json({ error: 'Image illisible' }); return; }

  const base = `galerie/${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const file = `${base}.webp`, thumbKey = `${base}-t.webp`;
  let url: string | undefined, thumbUrl: string;
  try {
    url = await storage.put(file, big.data);
    thumbUrl = await storage.put(thumbKey, thumb);
  } catch (e) {
    console.error(e);
    if (url) storage.remove(file, url).catch(() => {});
    res.status(502).json({ error: 'Le stockage des images ne répond pas, réessaie dans un instant' });
    return;
  }
  const photo = await prisma.photo.create({
    data: { memberId: req.member.id, file, thumb: thumbKey, url, thumbUrl, width: big.info.width, height: big.info.height, caption: text(body(req).caption, 200) || null },
    include: withAuthor,
  });
  res.status(201).json(photoView(photo));
});

gallery.delete('/api/gallery/:id', ...member, async (req, res) => {
  const p = await prisma.photo.findFirst({ where: { id: intParam(req, 'id'), deletedAt: null } });
  if (!p) { res.status(404).json({ error: 'not-found' }); return; }
  if (p.memberId !== req.member.id && !canAdmin(req.member)) { res.status(403).json({ error: 'forbidden' }); return; }
  await prisma.photo.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
  // la photo disparaît du site tout de suite ; un échec du stockage laisse seulement un fichier orphelin
  for (const [key, url] of [[p.file, p.url], [p.thumb, p.thumbUrl]]) await storage.remove(key, url).catch(e => console.error(e));
  res.json({ ok: true });
});

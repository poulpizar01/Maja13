// Galerie photo : lecture publique, dépôt par les membres validés, retrait par l'auteur ou la Gestion.
import crypto from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import multer from 'multer';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { prisma } from '../db.js';
import type { Member, Photo } from '../generated/prisma/client.js';
import { body, entier, intParam, member, text } from '../http.js';
import { author } from '../members.js';
import { canAdmin, canMember } from '../ranks.js';
import { storage } from '../storage.js';
import { limits } from '../security.js';

export const gallery = Router();

// toujours servi : en dev c'est le stockage, en prod il sert les photos restées sur le disque
gallery.use('/uploads', express.static(storage.dir, { maxAge: '30d', immutable: true }));

// Images acceptées : photos fixes uniquement (pas de GIF ni d'image animée). Deux contrôles :
// 1. type annoncé par le navigateur (tri rapide, falsifiable) ; 2. format réel lu dans le contenu du fichier.
// Ce qui part ensuite au stockage est toujours un WebP réencodé ici, jamais le fichier reçu.
// Pas de HEIC : sharp ne sait pas le décoder (ses binaires ne lisent que l'AVIF dans ce conteneur). Un iPhone convertit
// de lui-même en JPEG quand le champ de la page n'annonce pas le HEIC (espace/galerie.html).
const FORMATS_ACCEPTES = ['jpeg', 'png', 'webp'];
const MAX_PIXELS = 25_000_000;                               // garde-fou contre les images piégées (décompression géante)
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});
const receivePhoto: RequestHandler = (req, res, next) => upload.single('photo')(req, res, err => {
  if (err) res.status(400).json({ error: (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (15 Mo max)' : 'Fichier refusé' });
  else next();
});

// format réel du fichier : null si accepté, sinon le message de refus
async function refusImage(buffer: Buffer): Promise<string | null> {
  let meta: Metadata;
  try { meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata(); } catch { return 'Image illisible'; }
  if (!meta.format || !FORMATS_ACCEPTES.includes(meta.format)) return 'Format refusé : jpg, png ou webp uniquement (pas de gif ni de heic)';
  if ((meta.pages ?? 1) > 1) return 'Les images animées ne sont pas acceptées';
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS) return 'Image trop grande (25 mégapixels max)';
  return null;
}

// Une photo à la fois : une image de 25 Mpx occupe ~210 Mo pendant son traitement ; deux en parallèle dépasseraient
// le plafond mémoire du conteneur (512 Mo). Les envois simultanés attendent leur tour (quelques secondes au plus).
let fileAttente: Promise<unknown> = Promise.resolve();
const unParUn = <T>(travail: () => Promise<T>): Promise<T> => {
  const tour = fileAttente.then(travail, travail);
  fileAttente = tour.catch(() => {});
  return tour;
};

// fichiers d'une photo (grande image et miniature) ; un échec du stockage laisse seulement un fichier orphelin
export const retirerFichiers = async (p: Pick<Photo, 'file' | 'url' | 'thumb' | 'thumbUrl'>) => {
  for (const [key, url] of [[p.file, p.url], [p.thumb, p.thumbUrl]]) await storage.remove(key, url).catch(e => console.error(e));
};

const withAuthor = { member: true } as const;
// auteur : nom RP et grade pour tout le monde (vitrine) ; pseudo Discord, avatar et identifiant seulement pour un membre connecté
const photoView = (p: Photo & { member: Member }, complet: boolean) => {
  const a = author(p.member);
  return { id: p.id, url: p.url, thumb: p.thumbUrl, width: p.width, height: p.height, caption: p.caption, createdAt: p.createdAt,
    author: complet ? a : { displayName: a.displayName, rankLabel: a.rankLabel, rankColor: a.rankColor } };
};

gallery.get('/api/gallery', async (req, res) => {
  const limit = Math.min(entier(req.query.limit) ?? 60, 200);
  const photos = await prisma.photo.findMany({ where: { deletedAt: null }, include: withAuthor, orderBy: { createdAt: 'desc' }, take: limit });
  // vue complète : comptes validés avec le rôle membre (un compte en attente, refusé ou sans le rôle a une session, pas l'accès)
  const moi = req.session.memberId ? await prisma.member.findUnique({ where: { id: req.session.memberId } }) : null;
  const complet = moi?.status === 'approved' && canMember(moi);
  res.json(photos.map(p => photoView(p, complet)));
});

// sans stockage configuré en production (storage.ts) : refus avant même de lire le fichier envoyé
const stockagePret: RequestHandler = (_req, res, next) => {
  if (storage.accepte) next();
  else res.status(503).json({ error: 'L’envoi de photos n’est pas encore configuré sur ce site (stockage des images manquant).' });
};

// Chaque envoi reçu garde son fichier en mémoire (15 Mo au plus) jusqu'à son tour de traitement : au-delà de quelques
// envois en même temps, tous membres confondus, le plafond mémoire du conteneur serait dépassé. Les suivants repassent.
const ENVOIS_MAX = 3;
let envois = 0;
const envoisBornes: RequestHandler = (_req, res, next) => {
  if (envois >= ENVOIS_MAX) { res.status(503).set('Retry-After', '10').json({ error: 'Trop de photos en cours d’envoi, réessaie dans quelques secondes.' }); return; }
  envois++;
  res.once('close', () => { envois--; });
  next();
};

gallery.post('/api/gallery', ...member, stockagePret, limits.upload, envoisBornes, receivePhoto, async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'Aucune image (jpg, png, webp — pas de gif ni de heic)' }); return; }
  const buffer = req.file.buffer;
  const refus = await refusImage(buffer);
  if (refus) { res.status(400).json({ error: refus }); return; }
  let big: { data: Buffer; info: OutputInfo }, thumb: Buffer;
  try {
    ({ big, thumb } = await unParUn(async () => {
      const img = sharp(buffer, { animated: false, limitInputPixels: MAX_PIXELS }).rotate();
      return {
        big: await img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true }),
        thumb: await img.clone().resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
      };
    }));
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
  try {
    const photo = await prisma.photo.create({
      data: { memberId: req.member.id, file, thumb: thumbKey, url, thumbUrl, width: big.info.width, height: big.info.height, caption: text(body(req).caption, 200) || null },
      include: withAuthor,
    });
    res.status(201).json(photoView(photo, true));
  } catch (e) {
    // fichiers déjà sur le stockage mais ligne non enregistrée : ils y resteraient sans que rien ne les référence
    console.error(e);
    await retirerFichiers({ file, url, thumb: thumbKey, thumbUrl });
    res.status(500).json({ error: 'La photo n’a pas pu être enregistrée, réessaie dans un instant' });
  }
});

gallery.delete('/api/gallery/:id', ...member, async (req, res) => {
  const p = await prisma.photo.findFirst({ where: { id: intParam(req, 'id'), deletedAt: null } });
  if (!p) { res.status(404).json({ error: 'not-found' }); return; }
  if (p.memberId !== req.member.id && !canAdmin(req.member)) { res.status(403).json({ error: 'forbidden' }); return; }
  await prisma.photo.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
  await retirerFichiers(p);   // la photo disparaît du site tout de suite, puis du stockage
  res.json({ ok: true });
});

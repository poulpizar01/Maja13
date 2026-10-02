// Conservation : un message ou une photo retiré disparaît du site aussitôt (deletedAt), sa ligne reste 30 jours en base
// (retrait par erreur, litige), puis elle est effacée pour de bon. Les fichiers des photos sont retirés du stockage dès
// le retrait (routes/gallery.ts) ; si le stockage n'a pas répondu ce jour-là, la purge s'en charge avant d'effacer la ligne.
import { prisma } from './db.js';
import { storage } from './storage.js';

const JOURS = 30;

async function purge() {
  const avant = new Date(Date.now() - JOURS * 24 * 3600e3);
  const messages = await prisma.message.deleteMany({ where: { deletedAt: { lt: avant } } });
  // Photos : la ligne est le seul endroit où figure l'adresse des fichiers. Leur suppression est redemandée au stockage
  // (sans effet s'ils sont déjà absents) ; s'il échoue encore, la ligne est gardée et la purge du lendemain réessaie.
  const photos = await prisma.photo.findMany({ where: { deletedAt: { lt: avant } }, select: { id: true, file: true, url: true, thumb: true, thumbUrl: true } });
  const effacees: number[] = [];
  for (const p of photos) {
    try {
      await storage.remove(p.file, p.url);
      await storage.remove(p.thumb, p.thumbUrl);
      effacees.push(p.id);
    } catch (e) { console.error(`[purge] photo ${p.id} gardée, fichiers non retirés du stockage :`, (e as Error).message); }
  }
  if (effacees.length) await prisma.photo.deleteMany({ where: { id: { in: effacees } } });
  if (messages.count || photos.length) console.log(`Purge : ${messages.count} message(s) et ${effacees.length} photo(s) sur ${photos.length} retirés depuis plus de ${JOURS} jours, effacés`);
}

// au démarrage puis une fois par jour ; unref : ce minuteur ne retient pas l'arrêt du serveur
export function planifierPurge() {
  const run = () => purge().catch(e => console.error('[purge]', e));
  run();
  setInterval(run, 24 * 3600e3).unref();
}

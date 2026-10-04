// Conservation : un message retiré disparaît du site aussitôt (deletedAt), sa ligne reste 7 jours en base (retrait par
// erreur, litige), puis elle est effacée pour de bon.
import { prisma } from './db.js';

const JOURS = 7;

async function purge() {
  const avant = new Date(Date.now() - JOURS * 24 * 3600e3);
  const messages = await prisma.message.deleteMany({ where: { deletedAt: { lt: avant } } });
  if (messages.count) console.log(`Purge : ${messages.count} message(s) retirés depuis plus de ${JOURS} jours, effacés`);
}

// au démarrage puis une fois par jour ; unref : ce minuteur ne retient pas l'arrêt du serveur
export function planifierPurge() {
  const run = () => purge().catch(e => console.error('[purge]', e));
  run();
  setInterval(run, 24 * 3600e3).unref();
}

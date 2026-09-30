/* Identité du site : lue dans site.json (racine du dépôt), insérée dans les pages au moment de les servir.
   Dans une page (.html, .css, robots.txt, sitemap.xml), {{cle}} est remplacé par la valeur de site.json ;
   {{Cle}} (majuscule) donne la même valeur avec une majuscule en tête (« la famille » → « La famille »).
   {{url}} vient de BASE_URL. Un nouveau site ne modifie que site.json, jamais les pages de l'espace membre. */
import { readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { RequestHandler } from 'express';
import { config } from './config.js';

const REQUIRED = ['nom', 'espace', 'groupe', 'devise', 'serveur', 'discord', 'description'] as const;

function load(): Record<string, string> {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(readFileSync(join(config.root, 'site.json'), 'utf8')); }
  catch (e) { console.error(`site.json illisible : ${(e as Error).message}`); process.exit(1); }
  const missing = REQUIRED.filter(k => typeof raw[k] !== 'string' || !raw[k]);
  if (missing.length) { console.error(`site.json : valeur manquante pour ${missing.join(', ')}`); process.exit(1); }
  // couleur d'accent : facultative, forcément une couleur hexadécimale (elle est insérée telle quelle dans les feuilles de style)
  const couleur = raw.couleur ?? '#e5484d';
  if (typeof couleur !== 'string' || !/^#[0-9a-f]{6}$/i.test(couleur)) { console.error('site.json : « couleur » doit être une couleur du type #e5484d'); process.exit(1); }
  return { ...(raw as Record<string, string>), couleur, url: config.baseUrl };
}
export const site = load();

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// remplace les {{cle}} ; une clé inconnue est laissée telle quelle (et signalée une fois)
const warned = new Set<string>();
export function render(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (all, key: string) => {
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    const value = site[key] ?? (key !== lower && site[lower] !== undefined ? upper(site[lower]) : undefined);
    if (value === undefined) { if (!warned.has(key)) { warned.add(key); console.warn(`site.json : {{${key}}} inconnu`); } return all; }
    return esc(value);
  });
}

// pages servies avec l'identité du site ; mises en cache en production (en dev, relues à chaque requête)
const TYPES: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const cache = new Map<string, string>();
export function renderFile(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const out = render(readFileSync(file, 'utf8'));
  if (process.env.NODE_ENV === 'production') cache.set(file, out);
  return out;
}

// sert les pages d'un dossier (index.html, extension .html facultative) ; le reste passe au middleware suivant
export function pages(dir: string): RequestHandler {
  const base = normalize(dir + sep);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let path = decodeURIComponent(req.path);
    if (path.endsWith('/')) path += 'index.html';
    else if (!extname(path)) path += '.html';
    const type = TYPES[extname(path)];
    const file = normalize(join(dir, path));
    if (!type || !file.startsWith(base) || /[\\/]\./.test(path)) return next();
    let body: string;
    try { body = renderFile(file); } catch { return next(); }
    res.type(type).send(body);
  };
}

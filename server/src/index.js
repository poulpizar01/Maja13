/* La Maja 13 — serveur : site vitrine + La Casa (espace membre)
   Express + PostgreSQL + Discord OAuth2 */
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import pg from 'pg';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, unlinkSync } from 'node:fs';
import multer from 'multer';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');            // racine du dépôt (index.html, styles.css, casa/…)
const {
  PORT = 3000, BASE_URL, SESSION_SECRET, POSTGRES_PASSWORD,
  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID,
  DISCORD_ROLE_MAP = '', ADMIN_DISCORD_IDS = '',
} = process.env;
// en Docker, la base s'appelle "maja13-db" et seul POSTGRES_PASSWORD est fourni
const DATABASE_URL = process.env.DATABASE_URL || (POSTGRES_PASSWORD && `postgres://maja13:${POSTGRES_PASSWORD}@maja13-db:5432/maja13`);
if (!DATABASE_URL) { console.error('Variable manquante dans .env : DATABASE_URL (ou POSTGRES_PASSWORD)'); process.exit(1); }
// connexion de dev sans Discord : uniquement en local (DEV_LOGIN=1 + BASE_URL sur localhost)
const DEV_LOGIN = process.env.DEV_LOGIN === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL || '');
if (process.env.DEV_LOGIN === '1' && !DEV_LOGIN) { console.error('DEV_LOGIN=1 refusé : BASE_URL doit être http://localhost'); process.exit(1); }
for (const k of ['BASE_URL', 'SESSION_SECRET', ...(DEV_LOGIN ? [] : ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_GUILD_ID'])])
  if (!process.env[k]) { console.error(`Variable manquante dans .env : ${k}`); process.exit(1); }

const RANKS = ['jefe', 'segundo', 'devweb', 'palabrero', 'commandante', 'sicario', 'soldado', 'recluta'];
const RANK_LABEL = { jefe: 'Jefe', segundo: 'Segundo', devweb: 'Dev Web', palabrero: 'Palabrero', commandante: 'Commandante', sicario: 'Sicario', soldado: 'Soldado', recluta: 'Recluta' };
const roleMap = Object.fromEntries(DISCORD_ROLE_MAP.split(',').filter(Boolean).map(p => p.split(':').map(s => s.trim())));
const adminIds = new Set(ADMIN_DISCORD_IDS.split(',').map(s => s.trim()).filter(Boolean));

const pool = new pg.Pool({ connectionString: DATABASE_URL });
// applique le schéma au démarrage (idempotent)
await pool.query(readFileSync(join(here, '..', 'sql', 'schema.sql'), 'utf8'));
const app = express();
app.set('trust proxy', 1);                     // derrière Caddy / Nginx
app.use(express.json({ limit: '32kb' }));
app.use(session({
  store: new (connectPg(session))({ pool, tableName: 'session' }),
  name: 'maja13.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: BASE_URL.startsWith('https'), maxAge: 30 * 24 * 3600 * 1000 },
}));

// ---------- Discord OAuth ----------
const DISCORD_API = 'https://discord.com/api/v10';
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;
const SCOPES = 'identify guilds.members.read';

app.get('/auth/discord', async (req, res) => {
  if (DEV_LOGIN) {
    const { rows: [row] } = await pool.query(`
      INSERT INTO members (discord_id, username, display_name, rank, is_admin, status, approved_at, last_login)
      VALUES ('dev-local', 'dev', 'Dev local', 'jefe', true, 'approved', now(), now())
      ON CONFLICT (discord_id) DO UPDATE SET last_login = now()
      RETURNING id`);
    req.session.memberId = row.id;
    return res.redirect('/casa/perfil.html');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.search = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES, state, prompt: 'none' });
  res.redirect(url.toString());
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error || !code || state !== req.session.oauthState) return res.redirect('/casa/?error=oauth');
    delete req.session.oauthState;

    // 1. code -> token
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    if (!tokenRes.ok) return res.redirect('/casa/?error=token');
    const { access_token } = await tokenRes.json();
    const auth = { headers: { Authorization: `Bearer ${access_token}` } };

    // 2. identité
    const user = await (await fetch(`${DISCORD_API}/users/@me`, auth)).json();

    // 3. appartenance au serveur Discord La Maja 13 (+ rôles)
    const memberRes = await fetch(`${DISCORD_API}/users/@me/guilds/${DISCORD_GUILD_ID}/member`, auth);
    if (!memberRes.ok) return res.redirect('/casa/?error=not-member');
    const member = await memberRes.json();
    const rankFromRole = RANKS.find(r => member.roles.some(id => roleMap[id] === r));   // le grade le plus élevé trouvé
    const isAdmin = adminIds.has(user.id) || ['jefe', 'segundo', 'devweb'].includes(rankFromRole);

    // 4. upsert membre — nouveau compte = en attente de validation par le Jefe ;
    //    les IDs de ADMIN_DISCORD_IDS sont Jefe et validés d'office (amorçage)
    const bootstrapJefe = adminIds.has(user.id);
    const { rows: [row] } = await pool.query(`
      INSERT INTO members (discord_id, username, avatar, display_name, rank, is_admin, status, approved_at, last_login)
      VALUES ($1, $2, $3, $4, COALESCE($5::text, $7::text), $6::boolean, $8::text, CASE WHEN $8::text = 'approved' THEN now() END, now())
      ON CONFLICT (discord_id) DO UPDATE SET
        username = EXCLUDED.username,
        avatar = EXCLUDED.avatar,
        rank = CASE WHEN $6::boolean AND members.rank = 'recluta' THEN 'jefe' ELSE COALESCE($5::text, members.rank) END,
        is_admin = members.is_admin OR EXCLUDED.is_admin,
        status = CASE WHEN $6::boolean THEN 'approved' ELSE members.status END,
        last_login = now()
      RETURNING id, status`,
      [user.id, user.username, user.avatar, member.nick || user.global_name || user.username, rankFromRole || null,
       bootstrapJefe, bootstrapJefe ? 'jefe' : 'recluta', bootstrapJefe ? 'approved' : 'pending']);

    req.session.memberId = row.id;
    res.redirect(row.status === 'approved' ? '/casa/perfil.html' : '/casa/espera.html');
  } catch (e) {
    console.error(e);
    res.redirect('/casa/?error=server');
  }
});

app.post('/auth/logout', (req, res) => req.session.destroy(() => res.clearCookie('maja13.sid').json({ ok: true })));

// ---------- API ----------
const canAdmin = m => m.is_admin || ['jefe', 'segundo', 'devweb'].includes(m.rank);
const isTop = m => ['jefe', 'devweb'].includes(m.rank);   // pouvoirs complets (nommer/rétrograder un Jefe, etc.)
const requireAuth = (req, res, next) => req.session.memberId ? next() : res.status(401).json({ error: 'unauthenticated' });
// charge le membre courant et exige un compte validé
const requireApproved = async (req, res, next) => {
  const { rows: [m] } = await pool.query('SELECT * FROM members WHERE id = $1', [req.session.memberId]);
  if (!m) return req.session.destroy(() => res.status(401).json({ error: 'unauthenticated' }));
  if (m.status !== 'approved') return res.status(403).json({ error: 'pending', status: m.status });
  req.member = m; next();
};
const requireAdmin = (req, res, next) => canAdmin(req.member) ? next() : res.status(403).json({ error: 'forbidden' });
const publicMember = m => ({
  id: m.id, discordId: m.discord_id, username: m.username,
  avatarUrl: m.avatar ? `https://cdn.discordapp.com/avatars/${m.discord_id}/${m.avatar}.${m.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256` : null,
  displayName: m.display_name, rank: m.rank, rankLabel: RANK_LABEL[m.rank], bio: m.bio, phoneRp: m.phone_rp,
  isAdmin: canAdmin(m), status: m.status, joinedAt: m.joined_at, lastLogin: m.last_login, approvedAt: m.approved_at,
});

app.get('/api/me', requireAuth, async (req, res) => {
  const { rows: [m] } = await pool.query('SELECT * FROM members WHERE id = $1', [req.session.memberId]);
  if (!m) return req.session.destroy(() => res.status(401).json({ error: 'unauthenticated' }));
  res.json(publicMember(m));
});

app.patch('/api/me', requireAuth, requireApproved, async (req, res) => {
  const displayName = String(req.body.displayName ?? '').trim().slice(0, 64);
  const bio = String(req.body.bio ?? '').trim().slice(0, 600);
  const phoneRp = String(req.body.phoneRp ?? '').trim().slice(0, 32);
  if (!displayName) return res.status(400).json({ error: 'displayName requis' });
  const { rows: [m] } = await pool.query(
    'UPDATE members SET display_name = $1, bio = $2, phone_rp = $3 WHERE id = $4 RETURNING *',
    [displayName, bio || null, phoneRp || null, req.session.memberId]);
  res.json(publicMember(m));
});

// la familia : liste des membres visible par les membres connectés
app.get('/api/familia', requireAuth, requireApproved, async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM members WHERE status = 'approved' ORDER BY array_position($1::text[], rank), display_name`, [RANKS]);
  res.json(rows.map(m => ({ discordId: m.discord_id, displayName: m.display_name, username: m.username, rank: m.rank, rankLabel: RANK_LABEL[m.rank], avatarUrl: publicMember(m).avatarUrl })));
});

// ---------- Admin (Jefe / Segundo) ----------
app.get('/api/admin/members', requireAuth, requireApproved, requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT m.*, a.display_name AS approved_by_name FROM members m
    LEFT JOIN members a ON a.id = m.approved_by
    ORDER BY (m.status = 'pending') DESC, array_position($1::text[], m.rank), m.display_name`, [RANKS]);
  res.json(rows.map(m => ({ ...publicMember(m), approvedByName: m.approved_by_name })));
});

app.patch('/api/admin/members/:id', requireAuth, requireApproved, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const target = (await pool.query('SELECT * FROM members WHERE id = $1', [id])).rows[0];
  if (!target) return res.status(404).json({ error: 'not-found' });
  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (req.body.displayName !== undefined) {
    const dn = String(req.body.displayName).trim().slice(0, 64);
    if (!dn) return res.status(400).json({ error: 'displayName requis' });
    add('display_name', dn);
  }
  if (req.body.rank !== undefined) {
    if (!RANKS.includes(req.body.rank)) return res.status(400).json({ error: 'grade inconnu' });
    // seul un Jefe peut nommer un Jefe ou toucher au grade d'un Jefe
    if ((req.body.rank === 'jefe' || target.rank === 'jefe') && !isTop(req.member)) return res.status(403).json({ error: 'jefe-only' });
    add('rank', req.body.rank);
  }
  if (req.body.status !== undefined) {
    if (!['pending', 'approved', 'rejected'].includes(req.body.status)) return res.status(400).json({ error: 'statut inconnu' });
    if (target.id === req.member.id) return res.status(400).json({ error: 'self' });
    add('status', req.body.status);
    add('approved_at', req.body.status === 'approved' ? new Date() : null);
    add('approved_by', req.body.status === 'approved' ? req.member.id : null);
  }
  if (!sets.length) return res.status(400).json({ error: 'rien à modifier' });
  vals.push(id);
  const { rows: [m] } = await pool.query(`UPDATE members SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  res.json(publicMember(m));
});

app.delete('/api/admin/members/:id', requireAuth, requireApproved, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.member.id) return res.status(400).json({ error: 'self' });
  const target = (await pool.query('SELECT rank FROM members WHERE id = $1', [id])).rows[0];
  if (target?.rank === 'jefe' && !isTop(req.member)) return res.status(403).json({ error: 'jefe-only' });
  await pool.query('DELETE FROM members WHERE id = $1', [id]);
  res.json({ ok: true });
});

app.get('/api/ranks', (_req, res) => res.json(RANKS.map(r => ({ value: r, label: RANK_LABEL[r] }))));

// ---------- Organigramme public (lecture libre, édition Jefe / Dev Web) ----------
const requireJefe = (req, res, next) => isTop(req.member) ? next() : res.status(403).json({ error: 'jefe-only' });
const orgPayload = async () => {
  const { rows: entries } = await pool.query('SELECT * FROM org_entries ORDER BY array_position($1::text[], rank), position, id', [RANKS]);
  const { rows: descs } = await pool.query('SELECT * FROM org_rank_desc');
  return { ranks: RANKS.map(r => ({ value: r, label: RANK_LABEL[r] })), entries, rankDesc: Object.fromEntries(descs.map(d => [d.rank, d.description])) };
};
app.get('/api/org', async (_req, res) => res.json(await orgPayload()));

const orgFields = b => ({
  rank: RANKS.includes(b.rank) ? b.rank : null,
  name: String(b.name ?? '').trim().slice(0, 64),
  subtitle: String(b.subtitle ?? '').trim().slice(0, 80) || null,
  description: String(b.description ?? '').trim().slice(0, 600) || null,
  is_open: !!b.isOpen,
});
app.post('/api/admin/org', requireAuth, requireApproved, requireJefe, async (req, res) => {
  const f = orgFields(req.body);
  if (!f.rank || !f.name) return res.status(400).json({ error: 'grade et nom requis' });
  const { rows: [{ n }] } = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM org_entries WHERE rank = $1', [f.rank]);
  await pool.query('INSERT INTO org_entries (rank, name, subtitle, description, is_open, position) VALUES ($1,$2,$3,$4,$5,$6)', [f.rank, f.name, f.subtitle, f.description, f.is_open, n]);
  res.status(201).json(await orgPayload());
});
app.patch('/api/admin/org/:id', requireAuth, requireApproved, requireJefe, async (req, res) => {
  const f = orgFields(req.body);
  if (!f.rank || !f.name) return res.status(400).json({ error: 'grade et nom requis' });
  await pool.query('UPDATE org_entries SET rank=$1, name=$2, subtitle=$3, description=$4, is_open=$5 WHERE id=$6', [f.rank, f.name, f.subtitle, f.description, f.is_open, Number(req.params.id)]);
  res.json(await orgPayload());
});
app.post('/api/admin/org/:id/move', requireAuth, requireApproved, requireJefe, async (req, res) => {
  const id = Number(req.params.id), dir = req.body.dir === 'up' ? -1 : 1;
  const { rows: [e] } = await pool.query('SELECT * FROM org_entries WHERE id = $1', [id]);
  if (!e) return res.status(404).json({ error: 'not-found' });
  const { rows: sib } = await pool.query('SELECT id FROM org_entries WHERE rank = $1 ORDER BY position, id', [e.rank]);
  const i = sib.findIndex(s => s.id === id), j = i + dir;
  if (j >= 0 && j < sib.length) { [sib[i], sib[j]] = [sib[j], sib[i]]; }
  for (let k = 0; k < sib.length; k++) await pool.query('UPDATE org_entries SET position = $1 WHERE id = $2', [k, sib[k].id]);
  res.json(await orgPayload());
});
app.delete('/api/admin/org/:id', requireAuth, requireApproved, requireJefe, async (req, res) => {
  await pool.query('DELETE FROM org_entries WHERE id = $1', [Number(req.params.id)]);
  res.json(await orgPayload());
});
app.put('/api/admin/org/rank-desc/:rank', requireAuth, requireApproved, requireJefe, async (req, res) => {
  if (!RANKS.includes(req.params.rank)) return res.status(400).json({ error: 'grade inconnu' });
  const d = String(req.body.description ?? '').trim().slice(0, 600) || null;
  await pool.query('INSERT INTO org_rank_desc (rank, description) VALUES ($1, $2) ON CONFLICT (rank) DO UPDATE SET description = EXCLUDED.description', [req.params.rank, d]);
  res.json(await orgPayload());
});

// ---------- Galerie photo (publique en lecture, dépôt par les membres validés) ----------
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(ROOT, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(f.mimetype)) });
const PHOTO_SELECT = `SELECT p.*, m.display_name, m.username, m.rank FROM photos p JOIN members m ON m.id = p.member_id WHERE p.deleted_at IS NULL`;
const photoRow = r => ({ id: r.id, url: `/uploads/${r.file}`, thumb: `/uploads/${r.thumb}`, width: r.width, height: r.height, caption: r.caption, createdAt: r.created_at,
  author: { id: r.member_id, displayName: r.display_name, username: r.username, rank: r.rank, rankLabel: RANK_LABEL[r.rank] } });

app.get('/api/gallery', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const { rows } = await pool.query(`${PHOTO_SELECT} ORDER BY p.created_at DESC LIMIT $1`, [limit]);
  res.json(rows.map(photoRow));
});

app.post('/api/gallery', requireAuth, requireApproved, (req, res, next) => upload.single('photo')(req, res, err => err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (15 Mo max)' : 'Fichier refusé' }) : next()), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image (jpg, png, webp, gif, heic)' });
  try {
    const base = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const img = sharp(req.file.buffer, { animated: false }).rotate();
    const big = await img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toFile(join(UPLOAD_DIR, `${base}.webp`));
    await img.clone().resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(join(UPLOAD_DIR, `${base}-t.webp`));
    const caption = String(req.body.caption ?? '').trim().slice(0, 200) || null;
    const { rows: [ins] } = await pool.query('INSERT INTO photos (member_id, file, thumb, width, height, caption) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [req.member.id, `${base}.webp`, `${base}-t.webp`, big.width, big.height, caption]);
    const { rows: [row] } = await pool.query(`${PHOTO_SELECT} AND p.id = $1`, [ins.id]);
    res.status(201).json(photoRow(row));
  } catch (e) { console.error(e); res.status(400).json({ error: "Image illisible" }); }
});

app.delete('/api/gallery/:id', requireAuth, requireApproved, async (req, res) => {
  const { rows: [p] } = await pool.query('SELECT * FROM photos WHERE id = $1 AND deleted_at IS NULL', [Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'not-found' });
  if (p.member_id !== req.member.id && !canAdmin(req.member)) return res.status(403).json({ error: 'forbidden' });
  await pool.query('UPDATE photos SET deleted_at = now() WHERE id = $1', [p.id]);
  for (const f of [p.file, p.thumb]) { try { unlinkSync(join(UPLOAD_DIR, f)); } catch {} }
  res.json({ ok: true });
});

// ---------- Pont avec le bot Discord (base du bot en lecture seule) ----------
const BOT_DATABASE_URL = process.env.BOT_DATABASE_URL || null;
const bot = BOT_DATABASE_URL ? new pg.Pool({ connectionString: BOT_DATABASE_URL, max: 4 }) : null;
const ACTIVITIES = {
  atm: { label: 'ATM', quota: 'actions' }, cambu: { label: 'Cambriolage', quota: 'actions' }, superette: { label: 'Supérette', quota: 'actions' },
  gofast: { label: 'Go Fast', quota: 'actions' }, fleeca: { label: 'Fleeca', quota: 'actions' }, braq_armurerie: { label: 'Armurerie', quota: 'actions' },
  bijouterie: { label: 'Bijouterie', quota: 'actions' }, pinebank: { label: 'Pinebank', quota: 'actions' }, human_labs: { label: 'Human Labs', quota: 'actions' },
  vente: { label: 'Vente', quota: 'vente' }, recolte: { label: 'Récolte', quota: 'recolte' },
  labo_heroine: { label: 'Labo héroïne', quota: 'labos' }, labo_sporex: { label: 'Labo sporex', quota: 'labos' }, labo_mexicana: { label: 'Labo mexicana', quota: 'labos' },
  labo_cannabis: { label: 'Labo cannabis', quota: 'labos' }, labo_cocaine: { label: 'Labo cocaïne', quota: 'labos' },
};
const QUOTA_LABEL = { actions: 'Actions', vente: 'Vente', recolte: 'Récolte', labos: 'Labos' };
const QUOTA_TYPES = Object.keys(QUOTA_LABEL);
const botQuery = async (sql, params = []) => { if (!bot) throw new Error('bot-off'); return (await bot.query(sql, params)).rows; };
// prochaine remise à zéro : dimanche 19h00 (heure de Paris)
const nextReset = () => {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const d = new Date(paris); d.setHours(19, 0, 0, 0); d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  if (d <= paris) d.setDate(d.getDate() + 7);
  return new Date(now.getTime() + (d - paris)).toISOString();
};
const botConfig = async () => {
  const [targets, rates, settings] = await Promise.all([botQuery('SELECT quota_type, weekly_target FROM quota_targets'), botQuery('SELECT quota_type, amount FROM salary_rates'), botQuery('SELECT key, value FROM settings')]);
  return { targets: Object.fromEntries(targets.map(r => [r.quota_type, r.weekly_target])), rates: Object.fromEntries(rates.map(r => [r.quota_type, Number(r.amount)])), settings: Object.fromEntries(settings.map(r => [r.key, r.value])) };
};
const summarize = (statRows, rates) => {
  const byType = Object.fromEntries(QUOTA_TYPES.map(q => [q, 0])); const acts = [];
  for (const r of statRows) { const a = ACTIVITIES[r.action]; if (!a) continue; byType[a.quota] += Number(r.count); if (Number(r.count)) acts.push({ key: r.action, label: a.label, count: Number(r.count) }); }
  const salaire = Object.entries(rates).reduce((s, [q, rate]) => s + (byType[q] ?? 0) * rate, 0);
  return { byType, activities: acts, salaire };
};
// nom d'affichage d'un Discord ID : compte La Casa si connu, sinon pseudo vu par le bot
const namesFor = async (ids) => {
  if (!ids.length) return {};
  const { rows } = await pool.query('SELECT discord_id, display_name FROM members WHERE discord_id = ANY($1)', [ids]);
  const names = Object.fromEntries(rows.map(r => [r.discord_id, r.display_name]));
  const missing = ids.filter(i => !names[i]);
  if (missing.length) for (const r of await botQuery('SELECT DISTINCT ON (user_id) user_id, username FROM transactions WHERE user_id = ANY($1) ORDER BY user_id, timestamp DESC', [missing])) names[r.user_id] = r.username || r.user_id;
  return names;
};

app.get('/api/bot/status', requireAuth, requireApproved, async (_req, res) => {
  if (!bot) return res.json({ configured: false });
  try { const s = await botConfig(); res.json({ configured: true, actions: botApiReady(), tier: s.settings.type_groupe || s.settings.tier || null, hasQuotas: Object.keys(s.targets).length > 0, nextReset: nextReset() }); }
  catch (e) { console.error(e); res.json({ configured: false, error: 'unreachable' }); }
});

app.get('/api/bot/me', requireAuth, requireApproved, async (req, res) => {
  if (!bot) return res.json({ configured: false });
  try {
    const id = req.member.discord_id;
    const [cfg, stats, cds, mapping] = await Promise.all([botConfig(),
      botQuery('SELECT action, count, points FROM stats WHERE user_id = $1', [id]),
      botQuery('SELECT action, expires_at FROM cooldowns WHERE user_id = $1 AND expires_at > now() ORDER BY expires_at', [id]),
      botQuery('SELECT game_name FROM user_mapping WHERE discord_id = $1', [id])]);
    const names = [req.member.display_name, req.member.username, ...mapping.map(m => m.game_name)];
    const [armes, fourr, ventes] = await Promise.all([
      botQuery('SELECT nom, reference, type, statut FROM armurerie WHERE pretee_a = ANY($1) ORDER BY nom', [names]),
      botQuery("SELECT count(*)::int AS n FROM fourrieres WHERE discord_id = $1 AND timestamp > now() - interval '7 days'", [id]),
      botQuery("SELECT id, item, quantite, statut, montant, timestamp FROM pending_sales WHERE discord_id = $1 AND statut = 'en_attente' ORDER BY timestamp DESC LIMIT 10", [id])]);
    const sum = summarize(stats, cfg.rates);
    res.json({ configured: true, nextReset: nextReset(), quotas: QUOTA_TYPES.map(q => ({ type: q, label: QUOTA_LABEL[q], count: sum.byType[q], target: cfg.targets[q] ?? null, rate: cfg.rates[q] ?? null })),
      activities: sum.activities, salaire: sum.salaire, cooldowns: cds.map(c => ({ action: c.action, label: ACTIVITIES[c.action]?.label || c.action, expiresAt: c.expires_at })),
      armes, fourrieres7j: fourr[0]?.n ?? 0, ventesEnAttente: ventes });
  } catch (e) { console.error(e); res.status(502).json({ error: 'bot-unreachable' }); }
});

app.get('/api/bot/dashboard', requireAuth, requireApproved, requireAdmin, async (_req, res) => {
  if (!bot) return res.json({ configured: false });
  try {
    const [cfg, items, stocks, history, stats, cds, taxes, armes, vehicules, pending, braq, fourr] = await Promise.all([botConfig(),
      botQuery('SELECT name, stock_group, display_order, visible_stock, vente FROM items ORDER BY display_order, name'),
      botQuery('SELECT item, quantite FROM stocks'),
      botQuery('SELECT timestamp, joueur, action, item, quantite, stock_avant, stock_apres FROM stock_history ORDER BY timestamp DESC LIMIT 60'),
      botQuery('SELECT user_id, action, count, points FROM stats'),
      botQuery('SELECT user_id, action, expires_at FROM cooldowns WHERE expires_at > now() ORDER BY expires_at'),
      botQuery('SELECT id, nom, type, telephone, echeance, actif, paye FROM taxes WHERE actif ORDER BY echeance'),
      botQuery('SELECT nom, reference, type, statut, pretee_a FROM armurerie ORDER BY statut, nom'),
      botQuery('SELECT plaque, modele, joueur, discord_id, timestamp FROM vehicules WHERE discord_id IS NOT NULL OR joueur IS NOT NULL ORDER BY timestamp DESC'),
      botQuery("SELECT id, joueur, discord_id, item, quantite, statut, montant, timestamp FROM pending_sales WHERE statut = 'en_attente' ORDER BY timestamp DESC LIMIT 30"),
      botQuery("SELECT action, count(*)::int AS n FROM braquages WHERE timestamp > now() - interval '7 days' GROUP BY action"),
      botQuery("SELECT joueur, plaque, modele, timestamp FROM fourrieres WHERE timestamp > now() - interval '7 days' ORDER BY timestamp DESC")]);
    // détail par coffre (bot ≥ 09/09/2026) — facultatif : le tableau marche sans
    let coffres = [];
    if (botApiReady()) { try { coffres = (await botApi('GET', '/stocks/coffres')).coffres || []; } catch (e) { console.warn('coffres:', e.message); } }
    const qty = Object.fromEntries(stocks.map(s => [s.item, s.quantite]));
    const coffre = items.map(i => ({ item: i.name, group: i.stock_group, quantite: qty[i.name] ?? 0, visible: i.visible_stock, vente: i.vente }));
    for (const s of stocks) if (!items.some(i => i.name === s.item)) coffre.push({ item: s.item, group: null, quantite: s.quantite, visible: true, vente: false });
    const byUser = {}; for (const r of stats) (byUser[r.user_id] = byUser[r.user_id] || []).push(r);
    const ids = [...new Set([...Object.keys(byUser), ...cds.map(c => c.user_id)])];
    const names = await namesFor(ids);
    const classement = Object.entries(byUser).map(([uid, rows]) => { const s = summarize(rows, cfg.rates); return { userId: uid, name: names[uid] || uid, ...s.byType, salaire: s.salaire, activities: s.activities }; })
      .sort((a, b) => b.salaire - a.salaire || (b.actions + b.vente + b.recolte + b.labos) - (a.actions + a.vente + a.recolte + a.labos));
    const { rows: approved } = await pool.query("SELECT discord_id, display_name FROM members WHERE status = 'approved'");
    const inactifs = approved.filter(m => !byUser[m.discord_id]).map(m => m.display_name);
    res.json({ configured: true, nextReset: nextReset(), targets: cfg.targets, rates: cfg.rates, quotaTypes: QUOTA_TYPES.map(q => ({ type: q, label: QUOTA_LABEL[q] })),
      coffre, coffres, history, classement, masseSalariale: classement.reduce((s, c) => s + c.salaire, 0), inactifs,
      cooldowns: cds.map(c => ({ name: names[c.user_id] || c.user_id, action: c.action, label: ACTIVITIES[c.action]?.label || c.action, expiresAt: c.expires_at })),
      taxes, armes, vehicules, ventesEnAttente: pending, braquages7j: braq.map(b => ({ action: b.action, label: ACTIVITIES[b.action]?.label || b.action, n: b.n })), fourrieres7j: fourr });
  } catch (e) { console.error(e); res.status(502).json({ error: 'bot-unreachable' }); }
});

// taxes & racket (admins) : toutes les taxes actives, groupées par type / zone
const TAX_FIXED = { sporex: 'Sporex', heroine: 'Héroïne', vente: 'Vente', fertilisant: 'Fertilisant' };
app.get('/api/bot/taxes', requireAuth, requireApproved, requireAdmin, async (_req, res) => {
  if (!bot) return res.json({ configured: false });
  try {
    const rows = await botQuery('SELECT id, nom, type, telephone, echeance, actif, paye, alerte_sent FROM taxes ORDER BY echeance');
    const now = Date.now();
    const taxes = rows.map(r => ({ id: r.id, nom: r.nom, type: r.type, typeLabel: TAX_FIXED[r.type] || r.type, isZone: !TAX_FIXED[r.type], telephone: r.telephone, echeance: r.echeance, actif: r.actif, paye: r.paye,
      late: !r.paye && new Date(r.echeance).getTime() < now, dueSoon: !r.paye && new Date(r.echeance).getTime() - now < 48 * 3600e3 && new Date(r.echeance).getTime() >= now }));
    const active = taxes.filter(x => x.actif);
    const cat = (key, label, list) => ({ key, label, total: list.length, toCollect: list.filter(x => !x.paye).length, late: list.filter(x => x.late).length });
    const zones = [...new Set(active.filter(x => x.isZone).map(x => x.type))].sort();
    const categories = [
      ...Object.entries(TAX_FIXED).map(([k, l]) => cat(k, l, active.filter(x => x.type === k))),
      ...zones.map(z => cat('zone:' + z, z, active.filter(x => x.type === z))),
      cat('all', 'Toutes les taxes', active)];
    res.json({ configured: true, categories, taxes: active, archived: taxes.filter(x => !x.actif).length });
  } catch (e) { console.error(e); res.status(502).json({ error: 'bot-unreachable' }); }
});

// armurerie (admins) : armes par statut + ventes de munitions de la semaine
app.get('/api/bot/armurerie', requireAuth, requireApproved, requireAdmin, async (_req, res) => {
  if (!bot) return res.json({ configured: false });
  try {
    const [armes, munitions] = await Promise.all([
      botQuery('SELECT id, nom, reference, statut, pretee_a, type FROM armurerie ORDER BY nom, reference'),
      botQuery("SELECT vendeur_username, acheteur_id, quantite, prix, timestamp FROM munitions_ventes WHERE timestamp > now() - interval '7 days' ORDER BY timestamp DESC LIMIT 30")]);
    const ids = [...new Set(munitions.map(m => m.acheteur_id))];
    const names = await namesFor(ids);
    const counts = { en_stock: 0, pretee: 0, perdue: 0 };
    for (const a of armes) counts[a.statut] = (counts[a.statut] || 0) + 1;
    res.json({ configured: true, counts, total: armes.length, armes,
      munitions: munitions.map(m => ({ vendeur: m.vendeur_username, acheteur: names[m.acheteur_id] || m.acheteur_id, quantite: m.quantite, prix: Number(m.prix), timestamp: m.timestamp })) });
  } catch (e) { console.error(e); res.status(502).json({ error: 'bot-unreachable' }); }
});

// ---------- Actions vers le bot (API interne du bot, voir server/deploy/bot-api-setup.sh) ----------
// Le site ne modifie jamais la base du bot lui-même : chaque action passe par
// le bot, qui applique sa propre logique et rafraîchit ses messages Discord.
const BOT_API_URL = (process.env.BOT_API_URL || '').replace(/\/+$/, '');
const BOT_API_TOKEN = process.env.BOT_API_TOKEN || '';
const botApiReady = () => !!(BOT_API_URL && BOT_API_TOKEN);
const botApi = async (method, path, body) => {
  if (!botApiReady()) { const e = new Error('bot-api-off'); e.status = 503; throw e; }
  const r = await fetch(BOT_API_URL + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_API_TOKEN}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) { const e = new Error(data.error || `bot ${r.status}`); e.status = r.status >= 400 && r.status < 500 ? r.status : 502; throw e; }
  return data;
};
const relay = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) {
    if (e.status === 503) return res.status(503).json({ error: "Le bot n'est pas relié au site (API interne absente)." });
    if (e.status && e.status < 500) return res.status(e.status).json({ error: e.message });
    console.error('[bot-api]', e.message); res.status(502).json({ error: 'Le bot ne répond pas.' });
  }
};
const who = req => ({ userId: req.member.discord_id, userTag: req.member.display_name || req.member.username });

// activités : liste (avec cooldowns du membre) + déclaration + mes déclarations
app.get('/api/bot/activites', requireAuth, requireApproved, relay(async req => {
  if (!botApiReady()) return { configured: false };
  const d = await botApi('GET', `/activites?user=${encodeURIComponent(req.member.discord_id)}`);
  return { configured: true, ...d };
}));
app.post('/api/bot/activites/declarer', requireAuth, requireApproved, relay(async req => {
  const b = req.body || {};
  return botApi('POST', '/activites/declarer', { ...who(req), key: String(b.key || ''), type: b.type, quantite: b.quantite, tempsRestant: b.tempsRestant, partenaires: Array.isArray(b.partenaires) ? b.partenaires.slice(0, 25) : [] });
}));
app.get('/api/bot/activites/transactions', requireAuth, requireApproved, relay(async req => {
  const all = canAdmin(req.member) && req.query.all === '1';
  return botApi('GET', `/activites/transactions?limit=${all ? 100 : 30}${all ? '' : '&user=' + encodeURIComponent(req.member.discord_id)}`);
}));
app.delete('/api/bot/activites/transactions/:id', requireAuth, requireApproved, requireAdmin, relay(async req =>
  botApi('DELETE', `/activites/transactions/${parseInt(req.params.id, 10)}`, { byTag: who(req).userTag, byId: req.member.discord_id })));

// taxes (admins)
app.get('/api/bot/taxes/types', requireAuth, requireApproved, requireAdmin, relay(() => botApi('GET', '/taxes/types')));
app.post('/api/bot/taxes', requireAuth, requireApproved, requireAdmin, relay(req => botApi('POST', '/taxes', req.body || {})));
app.post('/api/bot/taxes/:id/paye', requireAuth, requireApproved, requireAdmin, relay(req => botApi('POST', `/taxes/${parseInt(req.params.id, 10)}/paye`, req.body || {})));
app.post('/api/bot/taxes/:id/renouveler', requireAuth, requireApproved, requireAdmin, relay(req => botApi('POST', `/taxes/${parseInt(req.params.id, 10)}/renouveler`, req.body || {})));
app.delete('/api/bot/taxes/:id', requireAuth, requireApproved, requireAdmin, relay(req => botApi('DELETE', `/taxes/${parseInt(req.params.id, 10)}`)));

// armurerie (admins) + munitions (tout membre validé)
app.get('/api/bot/armurerie/types', requireAuth, requireApproved, requireAdmin, relay(() => botApi('GET', '/armurerie/types')));
app.post('/api/bot/armurerie/armes', requireAuth, requireApproved, requireAdmin, relay(req => botApi('POST', '/armurerie/armes', req.body || {})));
app.post('/api/bot/armurerie/armes/:id/:action(preter|rendre|perdue)', requireAuth, requireApproved, requireAdmin, relay(req => botApi('POST', `/armurerie/armes/${parseInt(req.params.id, 10)}/${req.params.action}`, req.body || {})));
app.post('/api/bot/armurerie/munitions/:action(fabrication|vente)', requireAuth, requireApproved, relay(req => botApi('POST', `/armurerie/munitions/${req.params.action}`, { ...(req.body || {}), ...who(req) })));

// coffre (admins) + ventes en attente (le joueur concerné ou un admin)
app.post('/api/bot/stocks/set', requireAuth, requireApproved, requireAdmin, relay(req => botApi('POST', '/stocks/set', req.body || {})));
app.post('/api/bot/ventes/:id/:action(declarer|reposer|quantite)', requireAuth, requireApproved, relay(req => botApi('POST', `/ventes/${parseInt(req.params.id, 10)}/${req.params.action}`, { ...(req.body || {}), userId: req.member.discord_id, isAdmin: canAdmin(req.member) })));

// classement hebdo (tous les membres validés)
const weekStart = () => { const end = new Date(nextReset()); return new Date(end.getTime() - 7 * 86400e3).toISOString(); };
app.get('/api/bot/classement', requireAuth, requireApproved, async (_req, res) => {
  if (!bot) return res.json({ configured: false });
  try {
    const [cfg, stats] = await Promise.all([botConfig(), botQuery('SELECT user_id, action, count FROM stats')]);
    const byUser = {}; for (const r of stats) (byUser[r.user_id] = byUser[r.user_id] || []).push(r);
    const names = await namesFor(Object.keys(byUser));
    const rows = Object.entries(byUser).map(([uid, list]) => { const s = summarize(list, cfg.rates); return { userId: uid, name: names[uid] || `Membre #${uid.slice(-4)}`, ...s.byType, salaire: s.salaire, activities: s.activities }; })
      .filter(r => r.salaire > 0 || QUOTA_TYPES.some(q => r[q] > 0))
      .sort((a, b) => b.salaire - a.salaire || b.vente - a.vente);
    const targets = cfg.targets;
    const withTargets = QUOTA_TYPES.filter(q => targets[q]);
    const quotasOk = rows.filter(r => withTargets.length && withTargets.every(q => r[q] >= targets[q])).length;
    res.json({ configured: true, weekStart: weekStart(), nextReset: nextReset(), targets, rates: cfg.rates,
      totals: { vente: rows.reduce((s, r) => s + r.vente, 0), recolte: rows.reduce((s, r) => s + r.recolte, 0), actions: rows.reduce((s, r) => s + r.actions, 0), labos: rows.reduce((s, r) => s + r.labos, 0), masse: rows.reduce((s, r) => s + r.salaire, 0) },
      quotasOk, members: rows.length, rows });
  } catch (e) { console.error(e); res.status(502).json({ error: 'bot-unreachable' }); }
});

// historique des paies : photo des stats du bot chaque dimanche 18h55 (Paris), avant la remise à zéro du bot
async function snapshotPay(force = false) {
  if (!bot) return { skipped: 'bot-off' };
  const end = new Date(nextReset()); const weekEnd = end.toISOString().slice(0, 10);
  const weekStart = new Date(end.getTime() - 7 * 86400e3).toISOString().slice(0, 10);
  const { rows: [done] } = await pool.query('SELECT 1 FROM pay_history WHERE week_end = $1 LIMIT 1', [weekEnd]);
  if (done && !force) return { skipped: 'already' };
  const [cfg, stats] = await Promise.all([botConfig(), botQuery('SELECT user_id, action, count FROM stats')]);
  const byUser = {}; for (const r of stats) (byUser[r.user_id] = byUser[r.user_id] || []).push(r);
  const names = await namesFor(Object.keys(byUser));
  let n = 0;
  for (const [uid, list] of Object.entries(byUser)) {
    const s = summarize(list, cfg.rates);
    if (!s.salaire && !QUOTA_TYPES.some(q => s.byType[q] > 0)) continue;
    await pool.query(`INSERT INTO pay_history (week_start, week_end, discord_id, name, by_type, salaire) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (week_end, discord_id) DO UPDATE SET by_type = EXCLUDED.by_type, salaire = EXCLUDED.salaire, name = EXCLUDED.name, snapshot_at = now()`,
      [weekStart, weekEnd, uid, names[uid] || null, JSON.stringify({ ...s.byType, targets: cfg.targets, rates: cfg.rates }), s.salaire]);
    n++;
  }
  console.log(`[paie] photo hebdo ${weekStart} → ${weekEnd} : ${n} membre(s)`);
  return { saved: n, weekEnd };
}
setInterval(() => {
  const p = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  if (p.getDay() === 0 && p.getHours() === 18 && p.getMinutes() >= 55) snapshotPay().catch(e => console.error('[paie]', e));
}, 60 * 1000);

app.get('/api/bot/paies', requireAuth, requireApproved, async (req, res) => {
  const { rows } = await pool.query('SELECT week_start, week_end, by_type, salaire, snapshot_at FROM pay_history WHERE discord_id = $1 ORDER BY week_end DESC LIMIT 16', [req.member.discord_id]);
  res.json(rows.map(r => ({ weekStart: r.week_start, weekEnd: r.week_end, salaire: Number(r.salaire), byType: r.by_type, snapshotAt: r.snapshot_at })));
});
app.post('/api/admin/paies/snapshot', requireAuth, requireApproved, requireAdmin, async (_req, res) => {
  try { res.json(await snapshotPay(true)); } catch (e) { console.error(e); res.status(502).json({ error: 'bot-unreachable' }); }
});

// ---------- Chat de la familia (SSE + POST) ----------
const chatClients = new Map();            // res -> member
const chatMember = m => ({ id: m.id, displayName: m.display_name, username: m.username, rank: m.rank, rankLabel: RANK_LABEL[m.rank], avatarUrl: publicMember(m).avatarUrl });
const chatBroadcast = (event, data) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of chatClients.keys()) { try { res.write(payload); } catch { chatClients.delete(res); } }
};
const chatPresence = () => {
  const seen = new Map();
  for (const m of chatClients.values()) seen.set(m.id, chatMember(m));
  return [...seen.values()].sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank) || a.displayName.localeCompare(b.displayName));
};
const chatRow = r => ({ id: r.id, content: r.content, createdAt: r.created_at, author: { id: r.member_id, displayName: r.display_name, username: r.username, rank: r.rank, rankLabel: RANK_LABEL[r.rank], avatarUrl: publicMember({ discord_id: r.discord_id, avatar: r.avatar }).avatarUrl } });
const CHAT_SELECT = `SELECT g.id, g.content, g.created_at, g.member_id, m.display_name, m.username, m.rank, m.discord_id, m.avatar
                     FROM messages g JOIN members m ON m.id = g.member_id WHERE g.deleted_at IS NULL`;

app.get('/api/chat/messages', requireAuth, requireApproved, async (req, res) => {
  const before = Number(req.query.before) || null;
  const { rows } = await pool.query(`${CHAT_SELECT} ${before ? 'AND g.id < $1' : ''} ORDER BY g.id DESC LIMIT 60`, before ? [before] : []);
  res.json(rows.reverse().map(chatRow));
});

app.post('/api/chat/messages', requireAuth, requireApproved, async (req, res) => {
  const content = String(req.body.content ?? '').trim().slice(0, 1000);
  if (!content) return res.status(400).json({ error: 'vide' });
  const { rows: [ins] } = await pool.query('INSERT INTO messages (member_id, content) VALUES ($1, $2) RETURNING id', [req.member.id, content]);
  const { rows: [row] } = await pool.query(`${CHAT_SELECT} AND g.id = $1`, [ins.id]);
  const msg = chatRow(row);
  chatBroadcast('message', msg);
  res.status(201).json(msg);
});

app.delete('/api/chat/messages/:id', requireAuth, requireApproved, async (req, res) => {
  const id = Number(req.params.id);
  const { rows: [g] } = await pool.query('SELECT member_id FROM messages WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!g) return res.status(404).json({ error: 'not-found' });
  if (g.member_id !== req.member.id && !canAdmin(req.member)) return res.status(403).json({ error: 'forbidden' });
  await pool.query('UPDATE messages SET deleted_at = now() WHERE id = $1', [id]);
  chatBroadcast('delete', { id });
  res.json({ ok: true });
});

// non lus + mentions pour le badge du menu
const mentionRegex = m => new RegExp('@(' + [m.display_name, m.username].filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\w-])', 'i');
app.get('/api/chat/unread', requireAuth, requireApproved, async (req, res) => {
  const { rows: [r] } = await pool.query('SELECT last_read_id FROM chat_reads WHERE member_id = $1', [req.member.id]);
  const last = r?.last_read_id ?? 0;
  const { rows } = await pool.query('SELECT id, content FROM messages WHERE id > $1 AND deleted_at IS NULL AND member_id <> $2 ORDER BY id', [last, req.member.id]);
  const re = mentionRegex(req.member);
  res.json({ unread: rows.length, mentions: rows.filter(m => re.test(m.content)).length, lastReadId: last });
});
app.post('/api/chat/read', requireAuth, requireApproved, async (req, res) => {
  const id = Number(req.body.lastId) || 0;
  await pool.query('INSERT INTO chat_reads (member_id, last_read_id) VALUES ($1, $2) ON CONFLICT (member_id) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id), updated_at = now()', [req.member.id, id]);
  res.json({ ok: true });
});
// liste des membres mentionnables (autocomplétion @)
app.get('/api/chat/mentions', requireAuth, requireApproved, async (_req, res) => {
  const { rows } = await pool.query("SELECT display_name, username FROM members WHERE status = 'approved' ORDER BY display_name");
  res.json(rows.map(r => ({ name: r.display_name, username: r.username })));
});

app.get('/api/chat/stream', requireAuth, requireApproved, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  chatClients.set(res, req.member);
  chatBroadcast('presence', chatPresence());
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); chatClients.delete(res); chatBroadcast('presence', chatPresence()); });
});

// ---------- statique ----------
app.use((req, res, next) => req.path.startsWith('/server/') ? res.status(404).end() : next());
app.use(express.static(ROOT, { extensions: ['html'], index: 'index.html', dotfiles: 'ignore' }));
app.use((_req, res) => res.status(404).sendFile(join(ROOT, '404.html'), err => err && res.send('404')));

app.listen(PORT, '0.0.0.0', () => console.log(`La Maja 13 en écoute sur le port ${PORT} (${BASE_URL})`));

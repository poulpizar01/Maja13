// Connexion Discord (OAuth2), connexion de dev locale et déconnexion.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { allRanks } from '../ranks.js';

const DISCORD_API = 'https://discord.com/api/v10';
const REDIRECT_URI = `${config.baseUrl}/auth/discord/callback`;
const SCOPES = 'identify guilds guilds.members.read';   // guilds : savoir si l'utilisateur est propriétaire du serveur

type DiscordUser = { id: string; username: string; global_name: string | null; avatar: string | null };
type GuildMember = { nick: string | null; roles: string[] };
type UserGuild = { id: string; owner: boolean };

export const auth = Router();

// nouvelle session à chaque connexion (évite la fixation de session), puis rattachement du membre
const openSession = (req: Request, memberId: number) => new Promise<void>((ok, ko) =>
  req.session.regenerate(err => { if (err) ko(err); else { req.session.memberId = memberId; ok(); } }));

auth.get('/auth/discord', async (req, res) => {
  if (config.devLogin) {
    const m = await prisma.member.upsert({
      where: { discordId: config.devDiscordId },
      create: { discordId: config.devDiscordId, username: 'dev', displayName: 'Dev local', isOwner: true, status: 'approved', approvedAt: new Date(), lastLogin: new Date() },
      update: { isOwner: true, lastLogin: new Date() },
    });
    await openSession(req, m.id);
    res.redirect('/casa/perfil.html');
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.search = new URLSearchParams({ client_id: config.discord.clientId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES, state, prompt: 'none' }).toString();
  res.redirect(url.toString());
});

auth.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error || typeof code !== 'string' || state !== req.session.oauthState) { res.redirect('/casa/?error=oauth'); return; }
    delete req.session.oauthState;

    // 1. code → jeton
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.discord.clientId, client_secret: config.discord.clientSecret, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    if (!tokenRes.ok) { res.redirect('/casa/?error=token'); return; }
    const { access_token } = await tokenRes.json() as { access_token: string };
    const discord = async <T>(path: string) => (await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bearer ${access_token}` } })).json() as Promise<T>;

    // 2. identité, appartenance au serveur (+ rôles), propriété du serveur
    const user = await discord<DiscordUser>('/users/@me');
    const memberRes = await fetch(`${DISCORD_API}/users/@me/guilds/${config.discord.guildId}/member`, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!memberRes.ok) { res.redirect('/casa/?error=not-member'); return; }
    const guildMember = await memberRes.json() as GuildMember;
    const guilds = await discord<UserGuild[]>('/users/@me/guilds');
    const owner = Array.isArray(guilds) && guilds.some(g => g.id === config.discord.guildId && g.owner === true);

    // 3. grade : le plus élevé dont le rôle Discord est porté ; nouveau compte = grade par défaut (propriétaire : premier grade à pouvoirs complets)
    const ranks = allRanks();
    const rankFromRole = ranks.find(r => r.discordRoleId && guildMember.roles.includes(r.discordRoleId))?.key;
    const startRank = owner ? ranks.find(r => r.canManage)?.key : ranks.find(r => r.isDefault)?.key;

    // 4. compte : créé en attente de validation, validé d'office pour le propriétaire
    const existing = await prisma.member.findUnique({ where: { discordId: user.id } });
    const m = await prisma.member.upsert({
      where: { discordId: user.id },
      create: {
        discordId: user.id, username: user.username, avatar: user.avatar,
        displayName: guildMember.nick || user.global_name || user.username,
        rankKey: rankFromRole ?? startRank ?? null, isOwner: owner,
        status: owner ? 'approved' : 'pending', approvedAt: owner ? new Date() : null, lastLogin: new Date(),
      },
      update: {
        username: user.username, avatar: user.avatar, isOwner: owner, lastLogin: new Date(),
        rankKey: rankFromRole ?? existing?.rankKey ?? (owner ? startRank ?? null : null),
        ...(owner && { status: 'approved' as const }),
      },
    });

    await openSession(req, m.id);
    res.redirect(m.status === 'approved' ? '/casa/perfil.html' : '/casa/espera.html');
  } catch (e) {
    console.error(e);
    res.redirect('/casa/?error=server');
  }
});

auth.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.clearCookie('maja13.sid').json({ ok: true }));
});

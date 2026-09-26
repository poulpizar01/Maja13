/*
 * Configuration publique centralisée — MAJA 13
 *
 * Ce fichier est volontairement lisible par le navigateur. N'y placez JAMAIS
 * de secret Discord ou de token privé.
 */
(function configureMaja13() {
  const config = {
    identity: {
      name: 'MAJA 13',
      shortName: 'M13',
      osName: 'M13 OS',
      slogan: 'La familia sobre todo.',
      description: 'Le réseau privé de MAJA 13 — univers fictif GTA RP / FiveM.',
      territory: 'Los Santos',
      serverName: 'Serveur FiveM à renseigner'
    },
    brand: {
      accent: '#9f2635',
      accentBright: '#c1394a',
      metal: '#ad8a4e',
      logo: 'assets/brand/logo-mark.svg',
      hero: 'assets/visuals/hero-maja13.webp',
      story: 'assets/visuals/story-maja13.webp',
      map: 'assets/visuals/map-placeholder.svg',
      ogImage: 'assets/visuals/og-placeholder.svg'
    },
    links: {
      siteUrl: '',
      discordMain: 'https://discord.gg/Wdnsa2mDt',
      discordRecruitment: '',
      fivemJoin: '',
      instagram: ''
    },
    discord: {
      mainGuildId: '',
      recruitmentGuildId: ''
    }
  };

  window.MAJA_CONFIG = Object.freeze(config);

  // Seuls ces trois-là sont pilotables depuis config.js : ce sont les accents
  // de marque. Le reste de la palette (fond parchemin, cartes, texte) vit
  // dans maja-theme.css sous les mêmes noms de variable (--maja-ink,
  // --maja-panel, --maja-ivory…) — ne pas les redéfinir ici, sous peine de
  // collision avec leur rôle déjà établi dans cette feuille de style.
  document.documentElement.style.setProperty('--maja-accent', config.brand.accent);
  document.documentElement.style.setProperty('--maja-accent-bright', config.brand.accentBright);
  document.documentElement.style.setProperty('--maja-metal', config.brand.metal);
})();

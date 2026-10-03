/* Espace membre — utilitaires partagés */
// nom du site (site.json), lu dans la page : <meta name="application-name">
const SITE_NAME = document.querySelector('meta[name="application-name"]')?.content || '';
const SITE_NAME_HTML = SITE_NAME.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Boîte de confirmation dans le style du site (remplace window.confirm)
window.espaceConfirm = function (message, { title = 'Confirmer', ok = 'Confirmer', cancel = 'Annuler', danger = false } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <p class="eyebrow">${SITE_NAME_HTML}</p>
        <h3 class="modal__title" id="modalTitle"></h3>
        <p class="modal__text"></p>
        <div class="modal__actions">
          <button class="btn btn--ghost" data-cancel></button>
          <button class="btn ${danger ? 'btn--ghost btn--danger' : 'btn--accent'}" data-ok></button>
        </div>
      </div>`;
    wrap.querySelector('.modal__title').textContent = title;
    wrap.querySelector('.modal__text').textContent = message;
    wrap.querySelector('[data-cancel]').textContent = cancel;
    wrap.querySelector('[data-ok]').textContent = ok;
    const close = v => { wrap.classList.remove('is-open'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); };
    wrap.querySelector('[data-cancel]').onclick = () => close(false);
    wrap.querySelector('[data-ok]').onclick = () => close(true);
    wrap.onclick = e => { if (e.target === wrap) close(false); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => { wrap.classList.add('is-open'); wrap.querySelector('[data-ok]').focus(); });
  });
};

// Transition entre pages (espace.css) : par défaut « vers-espace » (volet, arrivée depuis la vitrine) ;
// venant d'une autre page de l'espace, « interne » : seul le contenu change, le rail reste en place.
// L'arrivée ne sait pas d'où elle vient (document.referrer et navigation.activation.from vides : Referrer-Policy
// no-referrer, security.ts) : c'est la page quittée, qui connaît sa destination, qui laisse la consigne.
// Écouteurs posés dès l'en-tête : pagereveal précède le premier rendu.
addEventListener('pageswap', e => {
  try {
    const vers = e.viewTransition && new URL(e.activation.entry.url);
    if (vers && vers.origin === location.origin && vers.pathname.startsWith('/espace/')) sessionStorage.setItem('vt-interne', '1');
  } catch {}
});
addEventListener('pagereveal', e => {
  let interne = false;
  try { interne = sessionStorage.getItem('vt-interne') === '1'; sessionStorage.removeItem('vt-interne'); } catch {}
  if (interne && e.viewTransition) { e.viewTransition.types.clear(); e.viewTransition.types.add('interne'); }
});

// ================= Coque de l'espace membre : rail de navigation, onglets mobiles, palette de recherche =================
// La navigation est décrite une seule fois ici. Chaque page appelle espaceShell() à l'endroit où la coque doit apparaître
// (script en ligne, avant ses propres scripts : #logout, #chatBadge, #gestion existent donc quand ils s'exécutent).
// Le numéro de chaque rubrique (01, 02…) sert de « numéro de pose », repris dans l'en-tête de la page.
// acces : qui voit la rubrique (le serveur applique les mêmes règles) — sans : tout compte validé (son profil) ;
// membre : rôle Discord membre ou Gestion ; admin : grade de Gestion ; manage : pouvoirs complets (Administration, Hiérarchie)
const ESPACE_NAV = [
  { groupe: 'Moi', liens: [{ href: 'profil.html', label: 'Mon profil', court: 'Profil' }] },
  { groupe: 'Le groupe', acces: 'membre', liens: [
    { href: 'chat.html', label: 'Chat', court: 'Chat', badge: 'chat' },
    { href: 'galerie.html', label: 'Galerie', court: 'Galerie' },
    { href: 'classement.html', label: 'Classement', court: 'Classement' },
    { href: 'taxes.html', label: 'Taxes' },
    { href: 'armurerie.html', label: 'Armurerie' },
  ] },
  { groupe: 'Gestion', acces: 'admin', liens: [
    { href: 'tableau.html', label: 'Tableau de bord' },
    { href: 'stats.html', label: 'Statistiques' },
    { href: 'garages.html', label: 'Garage' },
    { href: 'admin.html', label: 'Administration', acces: 'manage' },
    { href: 'membres.html', label: 'Membres' },
    { href: 'organigramme.html', label: 'Hiérarchie', acces: 'manage' },
  ] },
];
// avatar d'une personne : sa photo si elle est connue, sinon rien (ni logo du site répété, ni pastille de remplacement)
window.espaceAvatar = (src, taille = 32) => src ? `<img class="avatar" src="${espaceEsc(src)}" alt="" width="${taille}" height="${taille}" loading="lazy">` : '';
const espaceEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
window.espaceShell = function () {
  const ici = location.pathname.split('/').pop() || 'index.html';
  let n = 0, poseIci = null;
  const lien = (l, groupe) => {
    const num = String(++n).padStart(2, '0'), actif = l.href === ici;
    if (actif) poseIci = { num, groupe, label: l.label };
    return `<a class="rail__lien${actif ? ' is-active' : ''}" href="${l.href}"${actif ? ' aria-current="page"' : ''}${l.acces ? ` data-acces="${l.acces}" hidden` : ''}>`
      + `<b>${num}</b><span>${l.label}</span>${l.badge ? `<i class="nav__badge" data-badge="${l.badge}"${l.badge === 'chat' ? ' id="chatBadge"' : ''} hidden></i>` : ''}</a>`;
  };
  const groupes = ESPACE_NAV.map(g => `<div class="rail__groupe"${g.acces ? ` data-acces="${g.acces}" hidden` : ''}><p>${g.groupe}</p>${g.liens.map(l => lien(l, g.groupe)).join('')}</div>`).join('');
  // onglets du bas (téléphone) : les rubriques de tous les jours, le reste dans « Plus »
  const onglets = ESPACE_NAV.flatMap(g => g.liens.map(l => ({ ...l, acces: l.acces || g.acces }))).filter(l => l.court).map(l =>
    `<a href="${l.href}"${l.href === ici ? ' class="is-active" aria-current="page"' : ''}${l.acces ? ` data-acces="${l.acces}" hidden` : ''}><span>${l.court}</span>${l.badge ? `<i class="nav__badge" data-badge="${l.badge}" hidden></i>` : ''}</a>`).join('');
  document.currentScript.insertAdjacentHTML('beforebegin', `
    <header class="barre" aria-label="${SITE_NAME_HTML}">
      <a class="barre__marque" href="../"><img src="../assets/logo.png" alt="" width="28" height="28"><span>${SITE_NAME_HTML}</span></a>
      <button class="barre__cherche" type="button" data-palette aria-label="Rechercher">⌕</button>
    </header>
    <aside class="rail" id="rail" aria-label="Espace membre">
      <a class="rail__marque" href="../"><img src="../assets/logo.png" alt="" width="32" height="32"><span>${SITE_NAME_HTML}</span></a>
      <button class="rail__cherche" type="button" data-palette><span>Rechercher</span><kbd>Ctrl K</kbd></button>
      <nav class="rail__nav">${groupes}</nav>
      <div class="rail__moi">
        <img id="railAvatar" src="../assets/favicon.png" alt="" width="36" height="36">
        <div><b id="railNom">—</b><small id="railGrade"></small></div>
      </div>
      <div class="rail__bas"><a href="../">Le site</a><button class="espace-logout" id="logout" type="button">Déconnexion</button></div>
    </aside>
    <nav class="onglets" aria-label="Navigation rapide">${onglets}<button type="button" id="ongletPlus" aria-expanded="false" aria-controls="rail"><span>Plus</span></button></nav>`);
  // « Plus » (téléphone) : le rail s'ouvre en panneau
  const rail = document.getElementById('rail'), plus = document.getElementById('ongletPlus');
  const ouvre = v => { rail.classList.toggle('is-open', v); document.body.classList.toggle('nav-lock', v); plus.setAttribute('aria-expanded', v); };
  plus.addEventListener('click', () => ouvre(!rail.classList.contains('is-open')));
  // fermé par un lien, ou par un toucher hors du panneau (le voile assombri est dessiné sur le body)
  document.addEventListener('click', e => {
    if (!rail.classList.contains('is-open')) return;
    if (e.target.closest('.rail__lien, .rail__bas a') || (!rail.contains(e.target) && !plus.contains(e.target))) ouvre(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ouvre(false); });
  document.querySelectorAll('[data-palette]').forEach(b => b.addEventListener('click', () => espacePalette()));
  // en-tête de la page : numéro de pose et rubrique à la place de l'ornement
  document.addEventListener('DOMContentLoaded', () => {
    const num = document.querySelector('.espace-page > .section__head .numeral');
    if (num && poseIci) num.textContent = `${poseIci.num} — ${poseIci.groupe}`;
  });
};

// Rubriques selon le grade + carte du membre connecté (appelé par chaque page avec /api/me)
window.espaceNav = function (me) {
  if (!me) return;
  window.espaceMoi = me;
  const permis = { membre: me.isMember, admin: me.isAdmin, manage: me.canManage };
  document.querySelectorAll('[data-acces]').forEach(el => { el.hidden = !permis[el.dataset.acces]; });
  const av = document.getElementById('railAvatar'); if (av && me.avatarUrl) av.src = me.avatarUrl;
  const nom = document.getElementById('railNom'); if (nom) nom.textContent = me.displayName || '—';
  const gr = document.getElementById('railGrade'); if (gr) gr.textContent = me.rankLabel || 'Sans grade';
};

// ---- Palette de recherche (Ctrl+K, ⌘K ou /) : pages, membres, actions ; navigation au clavier
window.espacePalette = function () {
  if (document.querySelector('.palette')) return;
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const visible = el => !el.closest('[hidden]');
  const pages = [...document.querySelectorAll('.rail__lien')].filter(visible)
    .map(a => ({ type: 'Pages', label: a.querySelector('span').textContent, hint: a.closest('.rail__groupe').querySelector('p').textContent, num: a.querySelector('b').textContent, href: a.getAttribute('href') }));
  const actions = [
    { type: 'Actions', label: 'Retour au site', hint: 'La vitrine publique', href: '../' },
    { type: 'Actions', label: 'Se déconnecter', hint: 'Fermer la session', run: () => document.getElementById('logout')?.click() },
  ];
  let membres = [], choix = 0, liste = [];
  const wrap = document.createElement('div');
  wrap.className = 'palette';
  wrap.innerHTML = `<div class="palette__box" role="dialog" aria-modal="true" aria-label="Recherche">
      <label class="palette__champ"><span aria-hidden="true">⌕</span><input type="search" placeholder="Aller à une page, chercher un membre…" autocomplete="off" aria-controls="paletteListe"></label>
      <ul class="palette__liste" id="paletteListe" role="listbox"></ul>
      <p class="palette__aide"><kbd>↑</kbd><kbd>↓</kbd> choisir <kbd>Entrée</kbd> ouvrir <kbd>Échap</kbd> fermer</p>
    </div>`;
  const input = wrap.querySelector('input'), ul = wrap.querySelector('ul');
  function rendu() {
    const q = norm(input.value.trim());
    const tout = [...pages, ...membres, ...actions];
    liste = !q ? [...pages, ...actions] : tout.filter(x => norm(`${x.label} ${x.hint || ''}`).includes(q))
      .sort((a, b) => norm(b.label).startsWith(q) - norm(a.label).startsWith(q)).slice(0, 12);
    choix = Math.min(choix, Math.max(0, liste.length - 1));
    let type = '';
    ul.innerHTML = liste.map((x, i) => `${x.type !== type ? `<li class="palette__type" role="presentation">${type = x.type}</li>` : ''}
      <li role="option" data-i="${i}" ${i === choix ? 'aria-selected="true"' : ''}>${x.avatar ? `<img src="${espaceEsc(x.avatar)}" alt="">` : `<b>${x.num || '→'}</b>`}<span>${espaceEsc(x.label)}</span><small>${espaceEsc(x.hint || '')}</small></li>`).join('')
      || '<li class="palette__vide">Aucun résultat</li>';
    ul.querySelector('[aria-selected]')?.scrollIntoView({ block: 'nearest' });
  }
  const ferme = () => { wrap.remove(); document.removeEventListener('keydown', touche, true); };
  const va = x => { if (!x) return; ferme(); x.run ? x.run() : (location.href = x.href); };
  function touche(e) {
    if (e.key === 'Escape') { e.preventDefault(); ferme(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); choix = (choix + (e.key === 'ArrowDown' ? 1 : -1) + liste.length) % Math.max(1, liste.length); rendu(); }
    else if (e.key === 'Enter') { e.preventDefault(); va(liste[choix]); }
  }
  input.addEventListener('input', () => { choix = 0; rendu(); });
  ul.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) va(liste[li.dataset.i]); });
  ul.addEventListener('mousemove', e => { const li = e.target.closest('[data-i]'); if (li && +li.dataset.i !== choix) { choix = +li.dataset.i; rendu(); } });
  wrap.addEventListener('click', e => { if (e.target === wrap) ferme(); });
  document.addEventListener('keydown', touche, true);
  document.body.appendChild(wrap);
  rendu(); input.focus();
  // membres : chargés à l'ouverture (annuaire, réservé à la Gestion)
  if (window.espaceMoi?.isAdmin) fetch('../api/membres', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : []).then(l => {
    membres = l.map(m => ({ type: 'Membres', label: m.displayName, hint: `${m.rankLabel || 'Sans grade'} · @${m.username}`, avatar: m.avatarUrl || '../assets/favicon.png', href: `membres.html?q=${encodeURIComponent(m.displayName)}` }));
    if (document.body.contains(wrap)) rendu();
  }).catch(() => {});
};
document.addEventListener('keydown', e => {
  const saisie = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !saisie)) {
    if (!document.getElementById('rail')) return;
    e.preventDefault(); espacePalette();
  }
});

// Badge « non lus » sur le chat, dans le rail et les onglets (mis à jour toutes les 30 s ; la page du chat le remet à zéro elle-même)
window.espaceUnread = async function () {
  const badges = document.querySelectorAll('[data-badge="chat"]'); if (!badges.length) return;
  try {
    const r = await fetch('../api/chat/unread', { credentials: 'same-origin' }); if (!r.ok) return;
    const d = await r.json();
    badges.forEach(b => {
      if (d.unread > 0) { b.textContent = d.unread > 99 ? '99+' : d.unread; b.classList.toggle('is-mention', d.mentions > 0); b.title = d.mentions ? `${d.mentions} mention${d.mentions > 1 ? 's' : ''} de toi` : `${d.unread} nouveau${d.unread > 1 ? 'x' : ''} message${d.unread > 1 ? 's' : ''}`; b.hidden = false; }
      else b.hidden = true;
    });
  } catch {}
};
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('espace-body--chat')) return;   // le chat gère lui-même
  espaceUnread(); setInterval(espaceUnread, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) espaceUnread(); });
});

// Couleur d'accent du site (site.json), en #rrggbb : valeur de départ d'un champ couleur resté vide — un champ
// <input type="color"> n'accepte pas var(--accent) et afficherait du noir à la place.
window.espaceAccent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase();
// Couleurs calculées de variables de espace.css (séries des graphiques) : un attribut SVG ne lit pas var(--…)
window.espaceCouleurs = (...noms) => { const css = getComputedStyle(document.body); return noms.map(n => css.getPropertyValue(n).trim()); };

// Formulaire dans une modale (même style que espaceConfirm). Résout avec les
// valeurs saisies, ou null si annulé. fields : [{ name, label, type, options, value, placeholder, required, hint }]
// half : true = demi-largeur (deux champs côte à côte) ; rows : hauteur d'une zone de texte
// type : text (défaut) | textarea | checkbox (value booléen, text = libellé de la case)
//        | radio (options [{ value, label, hint }]) | select (options [{ value, label }]) | color
// del : libellé d'un bouton de suppression ; s'il est cliqué, résout avec { _delete: true }
window.espaceForm = function (fields, { title = 'Saisie', text = '', ok = 'Valider', cancel = 'Annuler', danger = false, del = '' } = {}) {
  return new Promise(resolve => {
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const wrap = document.createElement('div');
    wrap.className = 'modal modal--form';
    wrap.innerHTML = `
      <form class="modal__box" role="dialog" aria-modal="true" novalidate>
        <p class="eyebrow">${SITE_NAME_HTML}</p>
        <h3 class="modal__title"></h3>
        <p class="modal__text" ${text ? '' : 'hidden'}></p>
        <div class="modal__fields"></div>
        <p class="modal__error" hidden></p>
        <div class="modal__actions">
          ${del ? '<button class="btn btn--ghost btn--danger modal__del" type="button" data-del></button>' : ''}
          <button class="btn btn--ghost" type="button" data-cancel></button>
          <button class="btn ${danger ? 'btn--ghost btn--danger' : 'btn--accent'}" type="submit" data-ok></button>
        </div>
      </form>`;
    wrap.querySelector('.modal__title').textContent = title;
    wrap.querySelector('.modal__text').textContent = text;
    wrap.querySelector('[data-cancel]').textContent = cancel;
    wrap.querySelector('[data-ok]').textContent = ok;
    if (del) wrap.querySelector('[data-del]').textContent = del;
    const box = wrap.querySelector('.modal__fields');
    box.innerHTML = fields.map(f => {
      let ctrl;
      if (f.type === 'textarea') ctrl = `<textarea class="admin-input" name="${esc(f.name)}" rows="${f.rows || 3}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
      else if (f.type === 'checkbox') ctrl = `<label class="check"><input type="checkbox" name="${esc(f.name)}" ${f.value ? 'checked' : ''}><span>${esc(f.text)}</span></label>`;
      else if (f.type === 'radio') ctrl = `<div class="choices">${f.options.map(o => `<label class="choice"><input type="radio" name="${esc(f.name)}" value="${esc(o.value)}" ${o.value === f.value ? 'checked' : ''}><span><b>${esc(o.label)}</b>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span></label>`).join('')}</div>`;
      else if (f.type === 'select') ctrl = `<select class="admin-select" name="${esc(f.name)}">${f.options.map(o => `<option value="${esc(o.value)}" ${o.value === (f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      else if (f.type === 'color') ctrl = `<input class="modal__color" type="color" name="${esc(f.name)}" value="${esc(f.value || espaceAccent())}">`;
      else ctrl = `<input class="admin-input" type="text" name="${esc(f.name)}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" autocomplete="off">`;
      // zones de clic : seul le contrôle (et le titre des champs de saisie, relié par for/id) réagit ;
      // l'aide et l'espace autour ne font rien. Cases et choix portent leur propre <label>.
      const id = `cf-${esc(f.name)}`;
      ctrl = ctrl.replace(/^<(input|textarea|select) /, `<$1 id="${id}" `);
      const title = !f.label ? '' : ['checkbox', 'radio', 'color'].includes(f.type)
        ? `<span class="modal__label">${esc(f.label)}${f.required ? ' *' : ''}</span>`
        : `<label class="modal__label" for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>`;
      return `<div class="modal__field${f.half ? ' modal__field--half' : ''}">${title}${ctrl}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
    }).join('');
    const err = wrap.querySelector('.modal__error');
    const close = v => { wrap.classList.remove('is-open'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    wrap.querySelector('[data-cancel]').onclick = () => close(null);
    if (del) wrap.querySelector('[data-del]').onclick = () => close({ _delete: true });
    wrap.onclick = e => { if (e.target === wrap) close(null); };
    wrap.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        if (f.type === 'checkbox') out[f.name] = box.querySelector(`[name="${f.name}"]`).checked;
        else if (f.type === 'radio') out[f.name] = box.querySelector(`[name="${f.name}"]:checked`)?.value ?? '';
        else out[f.name] = box.querySelector(`[name="${f.name}"]`).value.trim();
        if (f.required && !out[f.name]) { err.textContent = `« ${f.label} » est obligatoire.`; err.hidden = false; return; }
      }
      close(out);
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => { wrap.classList.add('is-open'); const first = box.querySelector('input,select,textarea'); if (first) first.focus(); });
  });
};

// Fenêtre de consultation (lecture seule), même style que espaceConfirm. rows : [{ label, value }] ;
// chaque valeur renseignée a un bouton pour la copier.
window.espaceInfo = function (title, rows) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wrap = document.createElement('div');
  wrap.className = 'modal modal--form';
  wrap.innerHTML = `
    <div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="infoTitle">
      <p class="eyebrow">${SITE_NAME_HTML}</p>
      <h3 class="modal__title" id="infoTitle">${esc(title)}</h3>
      <dl class="info">${rows.map((r, i) => `<div class="info__row"><dt>${esc(r.label)}</dt>
        <dd>${r.value ? `<span class="mono">${esc(r.value)}</span><button class="btn btn--ghost btn--sm" type="button" data-copy="${i}">Copier</button>` : '<span class="muted">—</span>'}</dd></div>`).join('')}</dl>
      <div class="modal__actions"><button class="btn btn--accent" type="button" data-close>Fermer</button></div>
    </div>`;
  const close = () => { wrap.classList.remove('is-open'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.onclick = async e => {
    if (e.target === wrap || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText(rows[b.dataset.copy].value); b.textContent = 'Copié ✓'; setTimeout(() => b.textContent = 'Copier', 1500); }
    catch { espaceToast('Copie impossible : sélectionne le texte à la main.', false); }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => { wrap.classList.add('is-open'); wrap.querySelector('[data-close]').focus(); });
};

// Durée lisible d'un coup d'œil : « 2 j 4 h », « 3 h 20 », « 12 min » (arrondie à la minute supérieure, jamais négative)
window.espaceDuree = function (ms) {
  const min = Math.max(1, Math.ceil(ms / 6e4)), h = Math.floor(min / 60), j = Math.floor(h / 24);
  return j >= 1 ? `${j} j${h % 24 ? ` ${h % 24} h` : ''}` : h >= 1 ? `${h} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}` : `${min} min`;
};

// Petit message furtif en bas de page (succès ou erreur)
window.espaceToast = function (message, ok = true) {
  let t = document.getElementById('espaceToast');
  if (!t) { t = document.createElement('div'); t.id = 'espaceToast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = message; t.classList.toggle('toast--error', !ok); t.classList.add('is-on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('is-on'), ok ? 3200 : 5200);
};

// Données du bot Discord (géré à part), lues via le site — voir server/src/routes/bot.ts
window.espaceBot = {
  // état de la liaison ; « error » (busy, unreachable, refused) : le compte est relié mais le bot ne peut pas répondre
  status: () => fetch('../api/bot/status', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : r.status === 429 || r.status >= 500 ? { configured: true, linked: true, error: 'busy' } : { configured: false })
    .catch(() => ({ configured: true, linked: true, error: 'unreachable' })),
  // lecture d'une rubrique de l'API du bot (ex. 'quotas/config', 'taxes?status=expired') ; lève une erreur { status, message }
  async get(path) {
    const r = await fetch('../api/bot/data/' + path, { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `Le bot a répondu ${r.status}`), { status: r.status });
    return d;
  },
  // affiche dans `el` ce qui empêche d'afficher les données (bot non relié au site, compte à connecter, bot indisponible) ;
  // renvoie le statut, avec linked à false quand il n'y a rien à lire. Le bouton de connexion n'est proposé que si le
  // compte n'est vraiment pas relié : se reconnecter à un bot saturé ou coupé ne ferait que le charger davantage.
  async gate(el) {
    const st = await espaceBot.status();
    const panne = { busy: 'Le bot Discord est très sollicité en ce moment. Réessaie dans quelques minutes.',
      unreachable: 'Le bot Discord ne répond pas pour le moment. Réessaie dans quelques minutes.',
      refused: 'Le bot Discord refuse ton compte : tu n’es plus sur le serveur Discord du groupe, ou il te manque le rôle requis.' }[st.error];
    el.hidden = st.linked && !panne;
    if (!st.configured) el.innerHTML = '<p class="admin-empty">Le bot Discord n\'est pas relié au site.</p>';
    else if (panne) { el.innerHTML = `<p class="admin-empty">${panne}</p>`; return { ...st, linked: false }; }
    else if (!st.linked) el.innerHTML = `<div class="admin-empty bot-gate"><p>Pour voir les données du bot Discord, connecte ton compte au bot (une fois par semaine environ).</p>
      <a class="btn btn--accent btn--sm" href="../auth/bot?next=${encodeURIComponent(location.pathname)}">Connecter mon compte au bot</a></div>`;
    return st;
  },
  // Rafraîchissement d'une page qui lit le bot : toutes les 5 min (durée du cache du site), jamais dans un onglet en
  // arrière-plan — des onglets oubliés épuiseraient le quota du bot pour tout le site. Au retour sur l'onglet, relecture
  // si la dernière a plus de 5 min. Un échec laisse les chiffres en place et le dit ; un jeton expiré arrête le suivi.
  every(load) {
    const PERIODE = 5 * 60000;
    let dernier = Date.now(), reussi = Date.now(), arrete = false;
    const relit = async () => {
      if (arrete || document.hidden || Date.now() - dernier < PERIODE - 1000) return;
      dernier = Date.now();
      try { await load(); reussi = Date.now(); }
      catch (e) {
        if (!e) return;   // redirection en cours (session fermée)
        if (e.status === 401) arrete = true;
        espaceToast(`Actualisation impossible : ${espaceBot.error(e)} Les chiffres affichés datent de ${new Date(reussi).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`, false);
      }
    };
    setInterval(relit, PERIODE);
    document.addEventListener('visibilitychange', relit);
  },
  // message d'erreur lisible pour une lecture refusée
  error: e => e.status === 403 ? 'Réservé aux rôles concernés dans le bot Discord.' : e.status === 401 ? 'Connexion au bot expirée : recharge la page.' : (e.message || 'Le bot ne répond pas.'),
  // noms RP des membres du site par ID Discord (repli : pseudo connu du bot, puis identifiant tronqué)
  async names(botUsers = []) {
    const annuaire = await fetch('../api/membres/noms', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : []).catch(() => []);
    const map = Object.fromEntries(botUsers.map(u => [u.userId, u.username]));
    for (const m of annuaire) map[m.discordId] = m.displayName;
    return id => map[id] || `Membre #${String(id).slice(-4)}`;
  },
  // catégorie de quota du bot (clé) → libellé affichable
  label: k => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' '),
  // semaine ISO (AAAA-Www) d'une date, pour ?week= ; `back` semaines avant la semaine en cours
  isoWeek(back = 0) {
    const d = new Date(Date.now() - back * 7 * 86400e3);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400e3 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  },
};

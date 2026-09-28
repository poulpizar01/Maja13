/* La Casa — utilitaires partagés */
// Boîte de confirmation dans le style du site (remplace window.confirm)
window.casaConfirm = function (message, { title = 'Confirmer', ok = 'Confirmer', cancel = 'Annuler', danger = false } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <p class="eyebrow">La Maja 13</p>
        <h3 class="modal__title" id="modalTitle"></h3>
        <p class="modal__text"></p>
        <div class="modal__actions">
          <button class="btn btn--ghost" data-cancel></button>
          <button class="btn ${danger ? 'btn--ghost btn--danger' : 'btn--gold'}" data-ok></button>
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

// Menu « Gestion » (hiérarchie) : affichage selon le grade + ouverture/fermeture
window.casaNav = function (me) {
  const g = document.getElementById('gestion'); if (!g) return;
  if (me && me.isAdmin) g.hidden = false;
  const org = document.getElementById('orgLink');
  if (org && me && me.canManage) org.hidden = false;
};
// Menu mobile (burger, affiché par styles.css quand les liens ne tiennent plus) : ajouté ici pour toutes les pages de La Casa
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.nav'), links = nav && nav.querySelector('.nav__links');
  if (!links || nav.querySelector('.nav__burger')) return;
  const burger = document.createElement('button');
  burger.className = 'nav__burger'; burger.type = 'button'; burger.setAttribute('aria-label', 'Menu'); burger.setAttribute('aria-expanded', 'false');
  burger.innerHTML = '<span></span><span></span><span></span>';
  links.before(burger);
  const toggle = open => { nav.classList.toggle('is-open', open); document.body.classList.toggle('nav-lock', open); burger.setAttribute('aria-expanded', open); };
  burger.addEventListener('click', () => toggle(!nav.classList.contains('is-open')));
  links.addEventListener('click', e => { if (e.target.closest('a')) toggle(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
  matchMedia('(min-width:1181px)').addEventListener('change', e => { if (e.matches) toggle(false); });
});

document.addEventListener('DOMContentLoaded', () => {
  const g = document.getElementById('gestion'); if (!g) return;
  const btn = g.querySelector('.nav__group-btn');
  const close = () => { g.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => { e.stopPropagation(); const open = g.classList.toggle('is-open'); btn.setAttribute('aria-expanded', open); });
  document.addEventListener('click', e => { if (!g.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
});

// Badge « non lus » sur Le Salon (mis à jour toutes les 30 s ; la page du Salon le remet à zéro elle-même)
window.casaUnread = async function () {
  const b = document.getElementById('chatBadge'); if (!b) return;
  try {
    const r = await fetch('../api/chat/unread', { credentials: 'same-origin' }); if (!r.ok) return;
    const d = await r.json();
    if (d.unread > 0) { b.textContent = d.unread > 99 ? '99+' : d.unread; b.classList.toggle('is-mention', d.mentions > 0); b.title = d.mentions ? `${d.mentions} mention${d.mentions > 1 ? 's' : ''} de toi` : `${d.unread} nouveau${d.unread > 1 ? 'x' : ''} message${d.unread > 1 ? 's' : ''}`; b.hidden = false; }
    else b.hidden = true;
  } catch {}
};
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('casa-body--chat')) return;   // le Salon gère lui-même
  casaUnread(); setInterval(() => { if (!document.hidden) casaUnread(); }, 30000);   // onglet caché : pas d'appel (rattrapé au retour)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) casaUnread(); });
});

// Formulaire dans une modale (même style que casaConfirm). Résout avec les
// valeurs saisies, ou null si annulé. fields : [{ name, label, type, options, value, placeholder, required, hint }]
// half : true = demi-largeur (deux champs côte à côte) ; rows : hauteur d'une zone de texte
// type : text (défaut) | textarea | checkbox (value booléen, text = libellé de la case)
//        | radio (options [{ value, label, hint }]) | color
// del : libellé d'un bouton de suppression ; s'il est cliqué, résout avec { _delete: true }
window.casaForm = function (fields, { title = 'Saisie', text = '', ok = 'Valider', cancel = 'Annuler', danger = false, del = '' } = {}) {
  return new Promise(resolve => {
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const wrap = document.createElement('div');
    wrap.className = 'modal modal--form';
    wrap.innerHTML = `
      <form class="modal__box" role="dialog" aria-modal="true" novalidate>
        <p class="eyebrow">La Maja 13</p>
        <h3 class="modal__title"></h3>
        <p class="modal__text" ${text ? '' : 'hidden'}></p>
        <div class="modal__fields"></div>
        <p class="modal__error" hidden></p>
        <div class="modal__actions">
          ${del ? '<button class="btn btn--ghost btn--danger modal__del" type="button" data-del></button>' : ''}
          <button class="btn btn--ghost" type="button" data-cancel></button>
          <button class="btn ${danger ? 'btn--ghost btn--danger' : 'btn--gold'}" type="submit" data-ok></button>
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
      else if (f.type === 'color') ctrl = `<input class="modal__color" type="color" name="${esc(f.name)}" value="${esc(f.value || '#c9a45c')}">`;
      else ctrl = `<input class="admin-input" type="text" name="${esc(f.name)}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" autocomplete="off">`;
      // zones de clic : seul le contrôle (et le titre des champs de saisie, relié par for/id) réagit ;
      // l'aide et l'espace autour ne font rien. Cases et choix portent leur propre <label>.
      const id = `cf-${esc(f.name)}`;
      ctrl = ctrl.replace(/^<(input|textarea) /, `<$1 id="${id}" `);
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

// Fenêtre de consultation (lecture seule), même style que casaConfirm. rows : [{ label, value }] ;
// chaque valeur renseignée a un bouton pour la copier.
window.casaInfo = function (title, rows) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wrap = document.createElement('div');
  wrap.className = 'modal modal--form';
  wrap.innerHTML = `
    <div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="infoTitle">
      <p class="eyebrow">La Maja 13</p>
      <h3 class="modal__title" id="infoTitle">${esc(title)}</h3>
      <dl class="info">${rows.map((r, i) => `<div class="info__row"><dt>${esc(r.label)}</dt>
        <dd>${r.value ? `<span class="mono">${esc(r.value)}</span><button class="btn btn--ghost btn--sm" type="button" data-copy="${i}">Copier</button>` : '<span class="muted">—</span>'}</dd></div>`).join('')}</dl>
      <div class="modal__actions"><button class="btn btn--gold" type="button" data-close>Fermer</button></div>
    </div>`;
  const close = () => { wrap.classList.remove('is-open'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.onclick = async e => {
    if (e.target === wrap || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText(rows[b.dataset.copy].value); b.textContent = 'Copié ✓'; setTimeout(() => b.textContent = 'Copier', 1500); }
    catch { casaToast('Copie impossible : sélectionne le texte à la main.', false); }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => { wrap.classList.add('is-open'); wrap.querySelector('[data-close]').focus(); });
};

// Petit message furtif en bas de page (succès ou erreur)
window.casaToast = function (message, ok = true) {
  let t = document.getElementById('casaToast');
  if (!t) { t = document.createElement('div'); t.id = 'casaToast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = message; t.classList.toggle('toast--error', !ok); t.classList.add('is-on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('is-on'), ok ? 3200 : 5200);
};

// Données du bot Discord (géré à part), lues via La Casa — voir server/src/routes/bot.ts
window.casaBot = {
  // lu une fois par page : les pages l'appellent dès le départ, en parallèle de /api/me, puis gate() reprend la même réponse
  status() {
    return this._status ??= fetch('../api/bot/status', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { configured: false }).catch(() => ({ configured: false }));
  },
  // lecture d'une rubrique de l'API du bot (ex. 'quotas/config', 'taxes?status=expired') ; lève une erreur { status, message }
  async get(path) {
    const r = await fetch('../api/bot/data/' + path, { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `Le bot a répondu ${r.status}`), { status: r.status });
    return d;
  },
  // affiche dans `el` ce qui empêche d'afficher les données (bot non relié au site, compte à connecter) ; renvoie le statut
  async gate(el) {
    const st = await casaBot.status();
    el.hidden = st.linked;
    if (!st.configured) el.innerHTML = '<p class="admin-empty">Le bot Discord n\'est pas relié à La Casa.</p>';
    else if (!st.linked) el.innerHTML = `<div class="admin-empty bot-gate"><p>Pour voir les données du bot Discord, connecte ton compte au bot (une fois par semaine environ).</p>
      <a class="btn btn--gold btn--sm" href="../auth/bot?next=${encodeURIComponent(location.pathname)}">Connecter mon compte au bot</a></div>`;
    return st;
  },
  // message d'erreur lisible pour une lecture refusée
  error: e => e.status === 403 ? 'Réservé aux rôles concernés dans le bot Discord.' : e.status === 401 ? 'Connexion au bot expirée : recharge la page.' : e.message,
  // noms RP des membres de La Casa par ID Discord (repli : pseudo connu du bot, puis identifiant tronqué) ;
  // familia : liste déjà chargée par la page (sinon lue ici)
  async names(botUsers = [], familia) {
    if (!Array.isArray(familia)) familia = await fetch('../api/familia', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : []).catch(() => []);
    const map = Object.fromEntries(botUsers.map(u => [u.userId, u.username]));
    for (const m of familia) map[m.discordId] = m.displayName;
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

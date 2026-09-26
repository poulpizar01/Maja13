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
  casaUnread(); setInterval(casaUnread, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) casaUnread(); });
});

// Formulaire dans une modale (même style que casaConfirm). Résout avec les
// valeurs saisies, ou null si annulé. fields : [{ name, label, type, options, value, placeholder, required, min, hint }]
// half : true = demi-largeur (deux champs côte à côte)
// type : text | number | select | multiselect | textarea | checkbox (value booléen, text = libellé de la case)
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
      const opts = (f.options || []).map(o => typeof o === 'string' ? { value: o, label: o } : o);
      let ctrl;
      if (f.type === 'select') ctrl = `<select class="admin-select" name="${esc(f.name)}" ${f.required ? 'required' : ''}>${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${opts.map(o => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      else if (f.type === 'multiselect') ctrl = `<div class="modal__checks">${opts.length ? opts.map(o => `<label class="check"><input type="checkbox" name="${esc(f.name)}" value="${esc(o.value)}"><span>${esc(o.label)}</span></label>`).join('') : '<span class="muted">Personne à sélectionner</span>'}</div>`;
      else if (f.type === 'textarea') ctrl = `<textarea class="admin-input" name="${esc(f.name)}" rows="${f.rows || 3}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
      else if (f.type === 'checkbox') ctrl = `<label class="check"><input type="checkbox" name="${esc(f.name)}" ${f.value ? 'checked' : ''}><span>${esc(f.text)}</span></label>`;
      else if (f.type === 'radio') ctrl = `<div class="choices">${opts.map(o => `<label class="choice"><input type="radio" name="${esc(f.name)}" value="${esc(o.value)}" ${o.value === f.value ? 'checked' : ''}><span><b>${esc(o.label)}</b>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span></label>`).join('')}</div>`;
      else if (f.type === 'color') ctrl = `<input class="modal__color" type="color" name="${esc(f.name)}" value="${esc(f.value || '#c9a45c')}">`;
      else ctrl = `<input class="admin-input" type="${f.type === 'number' ? 'number' : 'text'}" name="${esc(f.name)}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} placeholder="${esc(f.placeholder || '')}" autocomplete="off" ${f.list ? `list="dl-${esc(f.name)}"` : ''}>${f.list ? `<datalist id="dl-${esc(f.name)}">${f.list.map(v => `<option value="${esc(v)}">`).join('')}</datalist>` : ''}`;
      // zones de clic : seul le contrôle (et le titre des champs de saisie, relié par for/id) réagit ;
      // l'aide et l'espace autour ne font rien. Cases et choix portent leur propre <label>.
      const id = `cf-${esc(f.name)}`;
      ctrl = ctrl.replace(/^<(input|select|textarea) /, `<$1 id="${id}" `);
      const title = !f.label ? '' : ['checkbox', 'radio', 'multiselect', 'color'].includes(f.type)
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
        if (f.type === 'multiselect') out[f.name] = [...box.querySelectorAll(`input[name="${f.name}"]:checked`)].map(i => i.value);
        else if (f.type === 'checkbox') out[f.name] = box.querySelector(`[name="${f.name}"]`).checked;
        else if (f.type === 'radio') out[f.name] = box.querySelector(`[name="${f.name}"]:checked`)?.value ?? '';
        else { const el = box.querySelector(`[name="${f.name}"]`); out[f.name] = f.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim(); }
        if (f.required && (out[f.name] === '' || out[f.name] == null || (Array.isArray(out[f.name]) && !out[f.name].length))) { err.textContent = `« ${f.label} » est obligatoire.`; err.hidden = false; return; }
        if (f.type === 'number' && out[f.name] != null && f.min != null && out[f.name] < f.min) { err.textContent = `« ${f.label} » doit être au moins ${f.min}.`; err.hidden = false; return; }
      }
      close(out);
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => { wrap.classList.add('is-open'); const first = box.querySelector('input,select,textarea'); if (first) first.focus(); });
  });
};

// Petit message furtif en bas de page (succès ou erreur)
window.casaToast = function (message, ok = true) {
  let t = document.getElementById('casaToast');
  if (!t) { t = document.createElement('div'); t.id = 'casaToast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = message; t.classList.toggle('toast--error', !ok); t.classList.add('is-on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('is-on'), ok ? 3200 : 5200);
};

// Appel d'une action du bot via La Casa : renvoie la réponse, ou affiche l'erreur et renvoie null
window.casaAction = async function (method, url, body) {
  try {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { casaToast(d.error || 'Action refusée.', false); return null; }
    if (d.message) casaToast(d.message, true);
    return d;
  } catch { casaToast('Le site ne répond pas.', false); return null; }
};

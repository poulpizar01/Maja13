/* La Maja 13 — organigramme public, chargé depuis La Casa (/api/org) */
(function () {
  const root = document.getElementById('org');
  if (!root) return;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // grades « mis en avant » (réglage de chaque grade) : grande carte, taille décroissante du sommet vers la base
  function card(e, rank, level) {
    return `<div class="rank ${level ? `rank--feat rank--lvl${Math.min(level, 3)}` : ''} ${e.is_open ? 'rank--open' : ''}">
      <span class="rank__title">${esc(rank.label)}</span>
      <span class="rank__name">${esc(e.name)}</span>
      ${e.subtitle ? `<span class="rank__age">${esc(e.subtitle)}</span>` : ''}
      ${level && e.description ? `<p>${esc(e.description)}</p>` : ''}
    </div>`;
  }
  fetch('api/org').then(r => r.ok ? r.json() : null).then(data => {
    if (!data || !data.entries.length) return;
    const byRank = {};
    data.entries.forEach(e => (byRank[e.rank] = byRank[e.rank] || []).push(e));
    const parts = [];
    let level = 0;
    data.ranks.forEach(rank => {
      const list = byRank[rank.key]; if (!list) return;
      const lvl = rank.featured ? ++level : 0;
      if (parts.length) parts.push('<div class="org__line" aria-hidden="true"></div>');
      if (lvl && list.length === 1) parts.push(`<div class="org__tier reveal is-in">${card(list[0], rank, lvl)}</div>`);
      else parts.push(`<div class="org__tier org__tier--row reveal is-in">${list.map(e => card(e, rank, lvl)).join('')}</div>`);
      if (rank.description) parts.push(`<p class="org__desc reveal is-in">${esc(rank.description)}</p>`);
    });
    root.innerHTML = parts.join('');
    root.closest('section').hidden = false;
  }).catch(() => {});
})();

/* La Maja 13 — galerie publique (photos postées par les membres via La Casa) */
(function () {
  const sec = document.getElementById('galeria'), grid = document.getElementById('galeriaGrid');
  if (!sec) return;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let photos = [], cur = 0;
  const lb = document.getElementById('lightbox'), img = document.getElementById('lbImg'), cap = document.getElementById('lbCap');
  function show(i) {
    cur = (i + photos.length) % photos.length; const p = photos[cur];
    img.src = p.url; img.alt = p.caption || '';
    cap.innerHTML = `${p.caption ? `<i>${esc(p.caption)}</i> — ` : ''}<b>${esc(p.author.displayName)}</b> <span>${esc(p.author.rankLabel)}</span>`;
    lb.hidden = false; document.body.style.overflow = 'hidden';
  }
  const close = () => { lb.hidden = true; document.body.style.overflow = ''; };
  document.getElementById('lbClose').onclick = close;
  document.getElementById('lbPrev').onclick = () => show(cur - 1);
  document.getElementById('lbNext').onclick = () => show(cur + 1);
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  addEventListener('keydown', e => { if (lb.hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });

  fetch('api/gallery?limit=48').then(r => r.ok ? r.json() : []).then(list => {
    photos = list; if (!photos.length) return;
    grid.innerHTML = photos.map((p, i) => `
      <figure class="galeria__item reveal is-in ${p.width > p.height * 1.4 ? 'is-wide' : ''}">
        <button type="button" data-i="${i}"><img src="${esc(p.thumb)}" alt="${esc(p.caption)}" loading="lazy" width="${p.width}" height="${p.height}"></button>
        <figcaption>${p.caption ? `<i>${esc(p.caption)}</i>` : ''}<b>${esc(p.author.displayName)}</b></figcaption>
      </figure>`).join('');
    grid.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) show(Number(b.dataset.i)); });
    sec.hidden = false; const nav = document.getElementById('navGaleria'); if (nav) nav.hidden = false;
  }).catch(() => {});
})();

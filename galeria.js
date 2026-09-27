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

  // ---- bandeau : défilement automatique d'une photo toutes les 4 s, en pause dès qu'on s'en sert
  const prev = document.getElementById('galeriaPrev'), next = document.getElementById('galeriaNext');
  const STEP_MS = 4000, IDLE_MS = 8000;   // cadence ; reprise 8 s après la dernière action du visiteur
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let hovered = false, visible = false, lastUser = 0;
  const touched = () => { lastUser = Date.now(); };
  const atEnd = () => grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 4;
  // flèches et ligne de progression (portion visible du bandeau)
  const bar = document.getElementById('galeriaBar');
  function arrows() {
    prev.disabled = grid.scrollLeft <= 4; next.disabled = atEnd();
    const w = grid.scrollWidth || 1;
    bar.style.width = `${grid.clientWidth / w * 100}%`; bar.style.left = `${grid.scrollLeft / w * 100}%`;
  }
  // photo suivante (ou précédente) par rapport à la position actuelle ; au bout, retour au début
  function step(dir) {
    const x = grid.scrollLeft, items = [...grid.children];
    if (dir > 0 && atEnd()) { grid.scrollTo({ left: 0 }); return; }
    const target = dir > 0 ? items.find(el => el.offsetLeft > x + 4) : items.reverse().find(el => el.offsetLeft < x - 4);
    grid.scrollTo({ left: target ? target.offsetLeft : 0 });
  }
  setInterval(() => {
    if (still.matches || hovered || !visible || document.hidden || !lb.hidden || Date.now() - lastUser < IDLE_MS) return;
    if (grid.scrollWidth > grid.clientWidth) step(1);
  }, STEP_MS);
  prev.onclick = () => { touched(); step(-1); };
  next.onclick = () => { touched(); step(1); };
  grid.addEventListener('scroll', arrows, { passive: true });
  ['wheel', 'pointerdown', 'touchstart', 'keydown'].forEach(ev => grid.addEventListener(ev, touched, { passive: true }));
  sec.querySelector('.galeria').addEventListener('mouseenter', () => { hovered = true; });
  sec.querySelector('.galeria').addEventListener('mouseleave', () => { hovered = false; });
  // glisser à la souris (au doigt, le navigateur le fait déjà) ; un vrai glissé n'ouvre pas la photo
  let drag = null, draggedAt = 0;
  grid.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) drag = { x: e.clientX, left: grid.scrollLeft, moved: false }; });
  addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; grid.classList.add('is-dragging'); }
    if (drag.moved) { grid.scrollLeft = drag.left - dx; touched(); }
  });
  addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.moved) {
      draggedAt = Date.now();   // le clic qui suit le lâcher n'ouvre pas la photo
      const left = grid.scrollLeft; grid.classList.remove('is-dragging'); grid.scrollLeft = left;   // l'aimantation reprend sur la photo la plus proche
    }
    drag = null;
  });
  grid.addEventListener('dragstart', e => e.preventDefault());
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.4 }).observe(grid);
  addEventListener('resize', arrows);

  fetch('api/gallery?limit=48').then(r => r.ok ? r.json() : []).then(list => {
    photos = list; if (!photos.length) return;
    // largeur d'après les proportions de la photo (bornées : ni bandeau trop fin, ni panorama géant)
    const ratio = p => Math.min(1.9, Math.max(0.6, p.width / p.height || 1)).toFixed(3);
    grid.innerHTML = photos.map((p, i) => `
      <figure class="galeria__item" style="aspect-ratio:${ratio(p)}">
        <button type="button" data-i="${i}"><img src="${esc(p.thumb)}" alt="${esc(p.caption)}" loading="lazy" width="${p.width}" height="${p.height}"></button>
        <figcaption>${p.caption ? `<i>${esc(p.caption)}</i>` : ''}<b>${esc(p.author.displayName)}</b></figcaption>
      </figure>`).join('');
    grid.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b && Date.now() - draggedAt > 100) show(Number(b.dataset.i)); });
    sec.hidden = false; const nav = document.getElementById('navGaleria'); if (nav) nav.hidden = false;
    arrows();
  }).catch(() => {});
})();

/* La Maja 13 — interactions du site */
(function () {
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  const links = document.getElementById('navLinks');

  // nav solide au scroll
  const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // menu mobile
  const toggle = open => { nav.classList.toggle('is-open', open); document.body.classList.toggle('nav-lock', open); burger.setAttribute('aria-expanded', open); };
  burger.addEventListener('click', () => toggle(!nav.classList.contains('is-open')));
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => toggle(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
  matchMedia('(min-width:1181px)').addEventListener('change', e => { if (e.matches) toggle(false); });

  // apparition au scroll
  const els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach((en, i) => {
        if (en.isIntersecting) {
          en.target.style.transitionDelay = (Math.min(i, 5) * 80) + 'ms';
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => io.observe(el));
  } else {
    els.forEach(el => el.classList.add('is-in'));
  }
})();

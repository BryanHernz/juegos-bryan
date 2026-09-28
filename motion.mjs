export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function parallaxOffset(top, height, viewport, speed, enabled = true) {
  if (!enabled || ![top, height, viewport, speed].every(Number.isFinite) || viewport <= 0) return 0;
  return clamp((viewport / 2 - (top + height / 2)) * speed, -44, 44);
}

export function scrollProgress(scrollY, documentHeight, viewportHeight) {
  const range = documentHeight - viewportHeight;
  return range > 0 ? clamp(scrollY / range, 0, 1) : 0;
}

export function motionEnabled(reduced, compact, choice) {
  return !reduced && !compact && choice !== 'off';
}

export function initMotion() {
  if (typeof window === 'undefined') return;
  const html = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = window.matchMedia('(max-width: 860px)');
  const planes = [...document.querySelectorAll('[data-parallax]')];
  const revealItems = [...document.querySelectorAll('[data-reveal]')];
  const progress = document.querySelector('[data-scroll-progress]');
  const toggle = document.querySelector('[data-motion-toggle]');
  const chapters = [...document.querySelectorAll('[data-chapter]')].map(link => ({link, section: document.getElementById(link.dataset.chapter)})).filter(item => item.section);
  let choice = null;
  try { choice = window.localStorage.getItem('sala-uno.motion'); } catch { /* storage: unavailable */ }
  let enabled = false;
  let frame = 0;
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, {threshold: .06, rootMargin: '0px 0px 24px 0px'}) : null;

  function paint() {
    frame = 0;
    const viewport = window.innerHeight;
    const positions = planes.map(element => {
      const rect = element.parentElement.getBoundingClientRect();
      return {element, offset: parallaxOffset(rect.top, rect.height, viewport, Number(element.dataset.parallax), enabled)};
    });
    let active = null;
    for (const item of chapters) {
      const rect = item.section.getBoundingClientRect();
      if (rect.top <= viewport * .45 && rect.bottom > 150) active = item;
    }
    const percent = scrollProgress(window.scrollY, html.scrollHeight, viewport);
    if (progress) progress.style.transform = `scaleX(${percent})`;
    for (const {element, offset} of positions) element.style.transform = enabled ? `translate3d(0, ${offset.toFixed(2)}px, 0)` : '';
    for (const item of chapters) {
      if (item === active) item.link.setAttribute('aria-current', 'true');
      else item.link.removeAttribute('aria-current');
    }
  }
  function schedule() { if (!frame) frame = window.requestAnimationFrame(paint); }
  function configure() {
    enabled = motionEnabled(reduced.matches, compact.matches, choice);
    html.classList.toggle('motion-ready', enabled && !!observer);
    html.classList.toggle('motion-off', !enabled);
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.setAttribute('aria-label', enabled ? 'Desactivar animaciones' : 'Activar animaciones');
      toggle.title = reduced.matches ? 'Movimiento reducido por la configuración del sistema' : 'Cambiar animaciones';
      const label = toggle.querySelector('[data-motion-label]');
      if (label) label.textContent = enabled ? 'Movimiento' : 'Sin movimiento';
    }
    for (const element of revealItems) {
      if (observer && enabled && !element.classList.contains('is-visible')) observer.observe(element);
      else element.classList.add('is-visible');
    }
    schedule();
  }
  toggle?.addEventListener('click', () => {
    choice = enabled ? 'off' : 'on';
    try { window.localStorage.setItem('sala-uno.motion', choice); } catch { /* storage: unavailable */ }
    configure();
  });
  reduced.addEventListener('change', configure);
  compact.addEventListener('change', configure);
  window.addEventListener('scroll', schedule, {passive: true});
  window.addEventListener('resize', schedule, {passive: true});
  window.addEventListener('load', schedule, {once: true});
  configure();
}

export function loadLocalLogos() {
  if (typeof document === 'undefined') return;
  for (const target of document.querySelectorAll('[data-local-logo]')) {
    const src = target.dataset.localLogo;
    if (!/^assets\/[a-z0-9-]+\.(png|webp)$/i.test(src)) continue;
    const image = new Image();
    image.alt = 'Logo original de Nova Star';
    image.width = 260;
    image.height = 260;
    image.decoding = 'async';
    image.onload = () => { target.append(image); target.classList.add('has-logo'); };
    image.onerror = () => console.info('[identity:nova-star] Ejecutar tools/importar-logo.ps1 para copiar el logo original.');
    image.src = src;
  }
}

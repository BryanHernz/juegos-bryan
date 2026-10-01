export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function parallaxOffset(top, height, viewport, speed, enabled = true, limit = 96) {
  if (!enabled || ![top, height, viewport, speed, limit].every(Number.isFinite) || viewport <= 0 || height <= 0 || limit <= 0) return 0;
  return clamp((viewport / 2 - (top + height / 2)) * speed, -limit, limit);
}

export function scrollProgress(scrollY, documentHeight, viewportHeight) {
  if (![scrollY, documentHeight, viewportHeight].every(Number.isFinite)) return 0;
  const range = documentHeight - viewportHeight;
  return range > 0 ? clamp(scrollY / range, 0, 1) : 0;
}

export function motionEnabled(reduced) {
  return !reduced;
}

export function motionStrength(compact) { return compact ? .45 : 1; }

export function approach(current, target, factor = .18) {
  if (![current, target, factor].every(Number.isFinite)) return 0;
  return Math.abs(target - current) < .08 ? target : current + (target - current) * clamp(factor, .01, 1);
}

const controllers = new WeakMap();

export function initMotion() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (controllers.has(document)) return controllers.get(document);
  const html = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = window.matchMedia('(max-width: 900px)');
  const planes = [...document.querySelectorAll('[data-parallax]')].map(element => ({
    element, scene: element.closest('[data-motion-scene]') || element.parentElement,
    speed: Number(element.dataset.parallax), limit: Number(element.dataset.parallaxLimit || 96), current: 0
  }));
  const revealItems = [...document.querySelectorAll('[data-reveal]')];
  const scenes = [...document.querySelectorAll('[data-motion-scene]')];
  const progress = document.querySelector('[data-scroll-progress]');
  const status = document.querySelector('[data-motion-status]');
  const chapters = [...document.querySelectorAll('[data-chapter]')].map(link => ({
    link, section: document.getElementById(link.dataset.chapter)
  })).filter(item => item.section);
  let enabled = false;
  let frame = 0;
  let disposed = false;
  const removers = [];
  const listen = (target, name, handler, options) => {
    target.addEventListener(name, handler, options);
    removers.push(() => target.removeEventListener(name, handler, options));
  };
  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    }
  }, { threshold: .08, rootMargin: '0px 0px -18px 0px' }) : null;
  const sceneObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) entry.target.dataset.sceneVisible = String(entry.isIntersecting);
    schedule();
  }, { rootMargin: '120px 0px', threshold: 0 }) : null;

  function paint() {
    frame = 0;
    if (disposed || document.hidden) return;
    const viewport = window.innerHeight;
    const rects = new Map();
    const getRect = element => {
      if (!rects.has(element)) rects.set(element, element.getBoundingClientRect());
      return rects.get(element);
    };
    let moving = false;
    const updates = planes.map(plane => {
      const rect = getRect(plane.scene);
      const visible = rect.bottom >= -120 && rect.top <= viewport + 120;
      const target = visible ? parallaxOffset(rect.top, rect.height, viewport,
        plane.speed * motionStrength(compact.matches), enabled,
        compact.matches ? Math.min(30, plane.limit) : plane.limit) : plane.current;
      const next = enabled ? approach(plane.current, target) : 0;
      if (visible && Math.abs(next - target) > .04) moving = true;
      plane.current = next;
      return { element: plane.element, value: next };
    });
    let active = null;
    for (const item of chapters) {
      const rect = getRect(item.section);
      if (rect.top <= viewport * .45 && rect.bottom > 120) active = item;
    }
    const percent = scrollProgress(window.scrollY, html.scrollHeight, viewport);
    // A short final chapter cannot reach the activation line at the page end.
    const finalChapter = chapters.at(-1);
    if (percent === 1 && finalChapter) {
      const rect = getRect(finalChapter.section);
      if (rect.top < viewport && rect.bottom > 120) active = finalChapter;
    }
    if (progress) progress.style.transform = `scaleX(${percent})`;
    for (const update of updates) update.element.style.setProperty('--parallax-y', `${update.value.toFixed(2)}px`);
    for (const item of chapters) {
      if (item === active) item.link.setAttribute('aria-current', 'true');
      else item.link.removeAttribute('aria-current');
    }
    if (enabled && moving) schedule();
  }

  function schedule() {
    if (!disposed && !document.hidden && !frame) frame = window.requestAnimationFrame(paint);
  }

  function configure() {
    enabled = motionEnabled(reduced.matches);
    html.classList.toggle('motion-ready', enabled);
    html.classList.toggle('motion-off', !enabled);
    html.dataset.motion = reduced.matches ? 'reduced' : 'on';
    if (status) {
      status.hidden = enabled;
      status.textContent = reduced.matches
        ? 'El sistema tiene activado el movimiento reducido. El contenido sigue disponible sin animaciones.'
        : '';
    }
    revealObserver?.disconnect();
    for (const element of revealItems) {
      if (revealObserver && enabled && !element.classList.contains('is-visible')) revealObserver.observe(element);
      else element.classList.add('is-visible');
    }
    if (!enabled) {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      for (const plane of planes) {
        plane.current = 0;
        plane.element.style.setProperty('--parallax-y', '0px');
      }
    }
    schedule();
  }

  for (const scene of scenes) {
    if (sceneObserver) sceneObserver.observe(scene);
    else scene.dataset.sceneVisible = 'true';
  }
  listen(reduced, 'change', configure);
  listen(compact, 'change', configure);
  listen(window, 'scroll', schedule, { passive: true });
  listen(window, 'resize', schedule, { passive: true });
  listen(window, 'load', schedule, { once: true });
  listen(document, 'visibilitychange', () => {
    html.classList.toggle('motion-suspended', document.hidden);
    if (document.hidden && frame) { window.cancelAnimationFrame(frame); frame = 0; }
    if (!document.hidden) schedule();
  });
  const dispose = () => {
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    revealObserver?.disconnect();
    sceneObserver?.disconnect();
    for (const remove of removers) remove();
    html.classList.remove('motion-ready', 'motion-suspended');
    html.classList.add('motion-off');
    for (const plane of planes) plane.element.style.removeProperty('--parallax-y');
    for (const element of revealItems) element.classList.add('is-visible');
    controllers.delete(document);
  };
  controllers.set(document, dispose);
  configure();
  return dispose;
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

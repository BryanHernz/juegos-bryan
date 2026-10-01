import { initMotion } from './motion.mjs';

export function validScreenshotPath(value) {
  return typeof value === 'string' && /^assets\/screens\/[a-z0-9-]+\.webp$/.test(value);
}

export function initExperience() {
  if (typeof document === 'undefined') return;
  initMotion();
  const menu = document.querySelector('.menu-toggle');
  const nav = document.getElementById('site-nav');
  const setMenu = (open, focusFirst = false) => {
    menu?.setAttribute('aria-expanded', String(open));
    menu?.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    nav?.classList.toggle('is-open', open);
    if (open && focusFirst) nav?.querySelector('a[href]')?.focus();
  };
  menu?.addEventListener('click', event => setMenu(menu.getAttribute('aria-expanded') !== 'true', event.detail === 0));
  menu?.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setMenu(true, true); }
  });
  nav?.addEventListener('click', event => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.header')) setMenu(false);
  });
  document.addEventListener('focusin', event => {
    if (!event.target.closest('.header')) setMenu(false);
  });
  window.matchMedia('(min-width: 901px)').addEventListener('change', () => setMenu(false));

  for (const list of document.querySelectorAll('.gallery-controls')) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const select = button => {
      if (!validScreenshotPath(button.dataset.image)) return;
      const image = document.getElementById(button.getAttribute('aria-controls'));
      if (!image) return;
      for (const tab of tabs) {
        tab.setAttribute('aria-selected', String(tab === button));
        tab.tabIndex = tab === button ? 0 : -1;
      }
      image.src = button.dataset.image;
      image.alt = button.dataset.caption;
      image.closest('[data-lightbox]').dataset.lightbox = button.dataset.image;
    };
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => select(button));
      button.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault(); select(tabs[next]); tabs[next].focus();
      });
    });
  }
  const dialog = document.getElementById('image-dialog');
  let opener;
  function closeImage() {
    if (dialog?.open) dialog.close();
    document.body.classList.remove('dialog-open');
    opener?.focus({ preventScroll: true });
  }
  for (const button of document.querySelectorAll('[data-lightbox]')) {
    button.addEventListener('click', () => {
      const source = button.dataset.lightbox;
      if (!dialog || !validScreenshotPath(source)) return;
      opener = button;
      const image = dialog.querySelector('img');
      image.src = source;
      image.alt = button.querySelector('img')?.alt || 'Captura de la aplicación';
      dialog.querySelector('p').textContent = image.alt;
      dialog.showModal();
      document.body.classList.add('dialog-open');
      dialog.querySelector('button').focus();
    });
  }
  dialog?.querySelector('.lightbox-close')?.addEventListener('click', closeImage);
  dialog?.addEventListener('cancel', event => { event.preventDefault(); closeImage(); });
  dialog?.addEventListener('click', event => { if (event.target === dialog) closeImage(); });
  dialog?.addEventListener('close', () => document.body.classList.remove('dialog-open'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
      setMenu(false); menu.focus();
    }
  });
}

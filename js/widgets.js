/* ════════════════════════════════════════════════════════════
   Juttr site — index-only widgets (PRESERVED behaviour)
   Apps showcase + live theme demo + hero parallax.
   Ported verbatim from the original main.js so the two preserved
   island sections behave identically. Wrapped in an IIFE so its
   internals never collide with site.js globals.
   ════════════════════════════════════════════════════════════ */
(() => {
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─────────────── Parallax (hero image + Look section) ───────────────
// Viewport-relative: offset is driven by each element's distance from the
// viewport centre, so motion stays subtle wherever the element sits on the page
// (not a large absolute-scroll offset). will-change:transform is set in CSS.
const parallaxEls = document.querySelectorAll('[data-parallax]');
if (!reduceMotion && parallaxEls.length) {
  let ticking = false;
  const apply = () => {
    const vh = window.innerHeight;
    parallaxEls.forEach((el) => {
      const f = parseFloat(el.dataset.parallax) || 0.05;
      const rect = el.getBoundingClientRect();
      const delta = (rect.top + rect.height / 2) - vh / 2;
      el.style.transform = `translateY(${(-delta * f).toFixed(1)}px)`;
    });
    ticking = false;
  };
  apply();
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(apply); ticking = true; }
  }, { passive: true });
  window.addEventListener('resize', apply, { passive: true });
}

// ─────────────── Apps showcase ───────────────
const APPS = [
  { id: 'dashboard', name: 'Dashboard', img: 'assets/screens/dark-dashboard.webp', url: 'New Tab — Juttr', caption: '<strong>Dashboard.</strong> A customizable grid of widgets — your whole day at a glance.' },
  { id: 'boards', name: 'Boards', img: 'assets/screens/dark-boards.webp', url: 'Juttr — Boards', caption: '<strong>Boards.</strong> Drag-and-drop Kanban with columns, labels and checklists.' },
  { id: 'tasks', name: 'Tasks', img: 'assets/screens/dark-tasks.webp', url: 'Juttr — Tasks', caption: '<strong>Tasks.</strong> Priorities, due dates, sub-tasks and time tracking.' },
  { id: 'notes', name: 'Notes', img: 'assets/screens/dark-notes.webp', url: 'Juttr — Notes', caption: '<strong>Notes.</strong> A free-form sticky canvas, or a full rich-text editor.' },
  { id: 'focus', name: 'Focus', img: 'assets/screens/dark-focus.webp', url: 'Juttr — Focus', caption: '<strong>Focus.</strong> Pomodoro and deep-work timers with streaks and energy logs.' },
  { id: 'calendar', name: 'Calendar', img: 'assets/screens/dark-calendar.webp', url: 'Juttr — Calendar', caption: '<strong>Calendar.</strong> Reminders and task due dates together, in month / week / day views.' },
  { id: 'analytics', name: 'Analytics', img: 'assets/screens/dark-analytics.webp', url: 'Juttr — Analytics', caption: '<strong>Analytics.</strong> Focus trends, session counts and streaks — tracked privately.' },
  { id: 'tools', name: 'Tools', img: 'assets/screens/dark-tools.webp', url: 'Juttr — Tools', caption: '<strong>Tools.</strong> A bookmark launcher for the sites and apps you use most.' },
  { id: 'accounts', name: 'Accounts', img: 'assets/screens/dark-accounts.webp', url: 'Juttr — Accounts', caption: '<strong>Accounts.</strong> Every login organized by identity and category, one click to open.' },
];

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  boards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="5" height="7" rx="1.5"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5l1.8 1.8L9 5"/><path d="M4 14.5l1.8 1.8L9 13"/><path d="M13 7h7M13 15h7"/></svg>',
  notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5"/><path d="M8 13h7M8 17h5"/></svg>',
  focus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 13V9M12 1h0M9 1h6" stroke-linecap="round"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4" stroke-linecap="round"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2z"/></svg>',
  accounts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.6 4.4-1.6 5 0M14 9.5h4M14 13h3" stroke-linecap="round"/></svg>',
};

const rail = document.getElementById('showcaseRail');
const stage = document.getElementById('showcaseShot');
const caption = document.getElementById('showcaseCaption');
const urlEl = document.getElementById('showcaseUrl');

let current = 0;
let autoTimer = null;

if (rail && stage) {
  APPS.forEach((app, i) => {
    const btn = document.createElement('button');
    btn.className = 'rail-btn' + (i === 0 ? ' active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.innerHTML = `${ICONS[app.id] || ''}<span>${app.name}</span>`;
    btn.addEventListener('click', () => { select(i); restartAuto(); });
    rail.appendChild(btn);

    const img = document.createElement('img');
    img.src = app.img;
    img.alt = `Juttr ${app.name}`;
    img.loading = i === 0 ? 'eager' : 'lazy';
    if (i === 0) img.classList.add('active');
    stage.appendChild(img);
  });

  const buttons = () => rail.querySelectorAll('.rail-btn');
  const imgs = () => stage.querySelectorAll('img');

  function select(i) {
    if (i === current) return;
    buttons()[current].classList.remove('active');
    buttons()[current].setAttribute('aria-selected', 'false');
    imgs()[current].classList.remove('active');
    current = i;
    buttons()[current].classList.add('active');
    buttons()[current].setAttribute('aria-selected', 'true');
    imgs()[current].classList.add('active');
    caption.innerHTML = APPS[i].caption;
    if (urlEl) urlEl.textContent = APPS[i].url;
  }

  function restartAuto() {
    if (reduceMotion) return;
    clearInterval(autoTimer);
    autoTimer = setInterval(() => select((current + 1) % APPS.length), 4200);
  }

  caption.innerHTML = APPS[0].caption;
  if (urlEl) urlEl.textContent = APPS[0].url;
  restartAuto();

  const showcase = document.querySelector('.showcase');
  showcase.addEventListener('mouseenter', () => clearInterval(autoTimer));
  showcase.addEventListener('mouseleave', restartAuto);

  rail.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { select((current + 1) % APPS.length); restartAuto(); }
    if (e.key === 'ArrowLeft') { select((current - 1 + APPS.length) % APPS.length); restartAuto(); }
  });

  if (!reduceMotion && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((e) => { e.isIntersecting ? restartAuto() : clearInterval(autoTimer); });
    }, { threshold: 0.2 }).observe(showcase);
  }
}

// ─────────────── Theme demo ───────────────
const td = { mode: 'dark', accent: '#2dd4bf', opacity: 78, blur: 14, bg: null };

const preview = document.getElementById('themePreview');
const tpBg = document.getElementById('tpBg');
const tpOverlay = document.getElementById('tpOverlay');

function applyTheme() {
  if (!preview) return;
  const dark = td.mode === 'dark';
  const a = td.opacity / 100;
  const acc = td.accent;
  const S = preview.style;

  const r = parseInt(acc.slice(1, 3), 16);
  const g = parseInt(acc.slice(3, 5), 16);
  const b = parseInt(acc.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const onAccent = lum > 150 ? '#0c1413' : '#ffffff';

  S.setProperty('--tp-accent', acc);
  S.setProperty('--tp-accent-soft', acc + (dark ? '26' : '20'));
  S.setProperty('--tp-on-accent', onAccent);
  S.setProperty('--tp-blur', td.blur + 'px');

  if (dark) {
    S.setProperty('--tp-text', '#f1f3f6');
    S.setProperty('--tp-dim', 'rgba(241,243,246,0.62)');
    S.setProperty('--tp-faint', 'rgba(241,243,246,0.40)');
    S.setProperty('--tp-card-bg', `rgba(22,25,33,${a})`);
    S.setProperty('--tp-side-bg', `rgba(14,16,22,${a})`);
    S.setProperty('--tp-border', 'rgba(255,255,255,0.09)');
    S.setProperty('--tp-inset', 'rgba(255,255,255,0.06)');
  } else {
    S.setProperty('--tp-text', '#10131a');
    S.setProperty('--tp-dim', 'rgba(16,19,26,0.62)');
    S.setProperty('--tp-faint', 'rgba(16,19,26,0.42)');
    S.setProperty('--tp-card-bg', `rgba(255,255,255,${a})`);
    S.setProperty('--tp-side-bg', `rgba(248,249,251,${a})`);
    S.setProperty('--tp-border', 'rgba(0,0,0,0.09)');
    S.setProperty('--tp-inset', 'rgba(0,0,0,0.045)');
  }

  tpBg.style.backgroundImage = td.bg ? `url(${td.bg})` : 'none';
  tpBg.style.opacity = td.bg ? '1' : '0';
  preview.style.background = td.bg ? 'transparent' : (dark ? '#0b0d12' : '#e9ebef');
  tpOverlay.style.background = td.bg
    ? (dark ? 'rgba(0,0,0,0.40)' : 'rgba(255,255,255,0.30)')
    : 'transparent';
}

document.querySelectorAll('#modePills .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#modePills .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    td.mode = btn.dataset.mode;
    applyTheme();
  });
});
document.querySelectorAll('#swatches .swatch').forEach((s) => {
  s.addEventListener('click', () => {
    document.querySelectorAll('#swatches .swatch').forEach((x) => x.classList.remove('active'));
    s.classList.add('active');
    td.accent = s.dataset.color;
    applyTheme();
  });
});
const opacitySlider = document.getElementById('opacitySlider');
const opacityVal = document.getElementById('opacityVal');
if (opacitySlider) opacitySlider.addEventListener('input', () => {
  td.opacity = +opacitySlider.value; opacityVal.textContent = td.opacity + '%'; applyTheme();
});
const blurSlider = document.getElementById('blurSlider');
const blurVal = document.getElementById('blurVal');
if (blurSlider) blurSlider.addEventListener('input', () => {
  td.blur = +blurSlider.value; blurVal.textContent = td.blur + 'px'; applyTheme();
});
const bgUpload = document.getElementById('bgUpload');
if (bgUpload) bgUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = (ev) => { td.bg = ev.target.result; applyTheme(); };
  r.readAsDataURL(file);
});

applyTheme();
})();

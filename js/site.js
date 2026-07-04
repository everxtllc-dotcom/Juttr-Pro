/* ════════════════════════════════════════════════════════════
   Juttr site — shared interactions (all pages)
   Theme toggle · nav scroll · scroll reveal · lead-capture modal
   (/api/subscribe) · store links · pricing checkout (/api/create-checkout)
   ════════════════════════════════════════════════════════════ */

// ⬇️  Live Chrome Web Store listing for Juttr.
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/juttr/ekhlnpabcklhbbkilicfeiepcgdiklef';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─────────────── Theme toggle ───────────────
// (data-theme is set pre-paint by the inline <head> snippet to avoid FOUC.)
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  if (!root.getAttribute('data-theme')) {
    root.setAttribute('data-theme', localStorage.getItem('juttr-theme') || 'light');
  }
  if (toggle) {
    toggle.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('juttr-theme', next); } catch {}
    });
  }
})();

// ─────────────── Nav background on scroll ───────────────
const nav = document.getElementById('nav');
if (nav) {
  const onScroll = () => { nav.classList.toggle('scrolled', window.scrollY > 12); };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

// ─────────────── Mobile nav menu ───────────────
const navToggle = document.getElementById('nav-toggle');
if (nav && navToggle) {
  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  navToggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  document.querySelectorAll('#nav-links a').forEach((a) =>
    a.addEventListener('click', () => setOpen(false))
  );
}

// ─────────────── Scroll-spy (active nav link) ───────────────
// Only same-page (#…) links resolve to sections — blog pages have none, so this
// safely no-ops there.
const spyLinks = [...document.querySelectorAll('#nav-links a[href^="#"]')];
const spyTargets = spyLinks
  .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
  .filter(Boolean);
if (spyTargets.length && 'IntersectionObserver' in window) {
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const id = e.target.id;
      spyLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
    });
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
  spyTargets.forEach((t) => spy.observe(t));
}

// ─────────────── Scroll reveal ───────────────
const revealEls = document.querySelectorAll('.reveal');
if (reduceMotion) {
  revealEls.forEach((el) => el.classList.add('in'));
} else if (revealEls.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach((el) => io.observe(el));
}

// ─────────────── Store links + lead capture ───────────────
// "Add to Chrome" links ask for a name + email once, store it in Supabase (via
// /api/subscribe), remember the visitor, then open the store.
const LEAD_KEY = 'juttr_lead';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SUBMIT_LABEL = 'Continue to Chrome Web Store';

const hasLead = () => { try { return !!localStorage.getItem(LEAD_KEY); } catch { return false; } };
const rememberLead = (email, saved) => {
  try { localStorage.setItem(LEAD_KEY, JSON.stringify({ email, saved, at: Date.now() })); } catch {}
};
const goToStore = () => {
  const w = window.open(CHROME_STORE_URL, '_blank', 'noopener');
  if (!w) window.location.href = CHROME_STORE_URL;
};

const leadModal = document.getElementById('leadModal');
const leadForm = document.getElementById('leadForm');
const leadName = document.getElementById('leadName');
const leadEmail = document.getElementById('leadEmail');
const leadCompany = document.getElementById('leadCompany');
const leadOptin = document.getElementById('leadOptin');
const leadError = document.getElementById('leadError');
const leadSubmit = document.getElementById('leadSubmit');
const leadSkip = document.getElementById('leadSkip');

let leadSource = 'site';
let lastFocused = null;

function openLeadModal(source) {
  if (!leadModal) { goToStore(); return; }
  leadSource = source;
  lastFocused = document.activeElement;
  leadError.textContent = '';
  leadSkip.hidden = true;
  leadSkip.innerHTML = '';
  leadSubmit.disabled = false;
  leadSubmit.textContent = SUBMIT_LABEL;
  leadName.classList.remove('invalid');
  leadEmail.classList.remove('invalid');
  leadModal.classList.add('is-open');
  leadModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('lead-open');
  setTimeout(() => { try { leadName.focus(); } catch {} }, 60);
  document.addEventListener('keydown', onLeadKey);
}

function closeLeadModal() {
  if (!leadModal) return;
  leadModal.classList.remove('is-open');
  leadModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('lead-open');
  document.removeEventListener('keydown', onLeadKey);
  if (lastFocused && lastFocused.focus) { try { lastFocused.focus(); } catch {} }
}

function onLeadKey(e) {
  if (e.key === 'Escape') { closeLeadModal(); return; }
  if (e.key === 'Tab') trapFocus(e);
}

function trapFocus(e) {
  const sel = 'a[href], button:not([disabled]), input:not([tabindex="-1"])';
  const list = Array.from(leadModal.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

document.querySelectorAll('[data-store-link]').forEach((a) => {
  if (a.tagName === 'A') a.href = CHROME_STORE_URL;
  a.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (hasLead()) { if (a.tagName !== 'A') goToStore(); return; }
    e.preventDefault();
    openLeadModal(a.getAttribute('data-store-link') || 'site');
  });
});

if (leadModal) {
  leadModal.querySelectorAll('[data-lead-close]').forEach((el) => el.addEventListener('click', closeLeadModal));
}

if (leadForm) {
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = leadName.value.trim();
    const email = leadEmail.value.trim();
    leadName.classList.toggle('invalid', !name);
    leadEmail.classList.toggle('invalid', !EMAIL_RE.test(email));
    if (!name) { leadError.textContent = 'Please enter your name.'; leadName.focus(); return; }
    if (!EMAIL_RE.test(email)) { leadError.textContent = 'Please enter a valid email address.'; leadEmail.focus(); return; }
    leadError.textContent = '';

    leadSubmit.disabled = true;
    leadSubmit.textContent = 'One moment…';

    const payload = {
      name, email,
      source: leadSource,
      opt_in: !!(leadOptin && leadOptin.checked),
      hp: leadCompany ? leadCompany.value : '',
    };

    let ok = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      ok = res.ok;
    } catch { ok = false; }

    if (ok) {
      rememberLead(email, true);
      goToStore();
      closeLeadModal();
    } else {
      leadSubmit.disabled = false;
      leadSubmit.textContent = SUBMIT_LABEL;
      leadError.textContent = "We couldn't save that just now — you can still continue.";
      leadSkip.hidden = false;
      leadSkip.innerHTML = '';
      const link = document.createElement('a');
      link.href = CHROME_STORE_URL;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Continue to the store anyway →';
      link.addEventListener('click', () => { rememberLead(email, false); closeLeadModal(); });
      leadSkip.appendChild(link);
    }
  });

  [leadName, leadEmail].forEach((el) => el && el.addEventListener('input', () => {
    el.classList.remove('invalid');
    if (leadError.textContent) leadError.textContent = '';
  }));
}

// ─────────────── Send-to-desktop (mobile → desktop email bridge) ───────────────
// One field, one button. Stores the lead via /api/subscribe with source
// "send-to-desktop"; the backend emails the install link when configured.
const stdForm = document.getElementById('stdForm');
if (stdForm) {
  const stdEmail = document.getElementById('stdEmail');
  const stdCompany = document.getElementById('stdCompany');
  const stdSubmit = document.getElementById('stdSubmit');
  const stdMsg = document.getElementById('stdMsg');
  const STD_LABEL = stdSubmit.textContent;

  stdForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = stdEmail.value.trim();
    if (!EMAIL_RE.test(email)) {
      stdEmail.classList.add('invalid');
      stdMsg.classList.add('err');
      stdMsg.textContent = 'Please enter a valid email address.';
      stdEmail.focus();
      return;
    }
    stdEmail.classList.remove('invalid');
    stdMsg.classList.remove('err');
    stdMsg.textContent = '';
    stdSubmit.disabled = true;
    stdSubmit.textContent = 'Sending…';

    let ok = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: email.split('@')[0],
          email,
          source: 'send-to-desktop',
          opt_in: true,
          hp: stdCompany ? stdCompany.value : '',
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      ok = res.ok;
    } catch { ok = false; }

    stdSubmit.disabled = false;
    stdSubmit.textContent = STD_LABEL;
    if (ok) {
      rememberLead(email, true);
      stdForm.querySelector('.jx-std-row').hidden = true;
      stdMsg.textContent = 'Done — the install link is on its way to your inbox.';
    } else {
      stdMsg.classList.add('err');
      stdMsg.textContent = "That didn't go through — please try again in a moment.";
    }
  });

  stdEmail.addEventListener('input', () => {
    stdEmail.classList.remove('invalid');
    if (stdMsg.classList.contains('err')) { stdMsg.classList.remove('err'); stdMsg.textContent = ''; }
  });
}

// ─────────────── Pricing → Checkout ───────────────
// Checkout now requires a signed-in account: the pricing CTAs are plain links
// to login.html?intent=upgrade&plan=…, which continues into Stripe Checkout
// after authentication (see js/auth.js → continueAfterAuth).

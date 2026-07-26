/* ════════════════════════════════════════════════════════════
   Juttr site — shared interactions (all pages)
   Theme · nav scroll · scroll reveal · store links (direct, nothing collected)
   send-to-desktop (/api/send-install-link) · pricing checkout (/api/create-checkout)
   ════════════════════════════════════════════════════════════ */

// ⬇️  Live Chrome Web Store listing for Juttr.
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/juttr/ekhlnpabcklhbbkilicfeiepcgdiklef';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─────────────── Theme ───────────────
// Dark is the only theme. Force it in case a stale 'light' value lingers in
// localStorage or the pre-paint <head> snippet.
document.documentElement.setAttribute('data-theme', 'dark');

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

// ─────────────── Store links ───────────────
// Every 'Add to Chrome' CTA is a plain link straight to the Chrome Web Store.
// Nothing is asked for, stored, or sent before the visitor reaches the store.
const EMAIL_RE = /^[^@s]+@[^@s]+.[^@s]+$/;

document.querySelectorAll('[data-store-link]').forEach((a) => {
  if (a.tagName === 'A') a.href = CHROME_STORE_URL;
});

// ─────────────── Send-to-desktop (mobile → desktop email bridge) ───────────────
// One field, one button. POSTs the address to /api/send-install-link, which mails
// the install link and stores NOTHING. No name, no marketing list, no opt-in.
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
      const res = await fetch('/api/send-install-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
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

// ─────────────── Pricing → Stripe Checkout ───────────────
const checkoutError = document.querySelector('[data-checkout-error]');
function showCheckoutError(msg) {
  if (!checkoutError) return;
  checkoutError.textContent = msg;
  checkoutError.hidden = false;
}
document.querySelectorAll('[data-checkout]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const plan = btn.getAttribute('data-checkout') === 'yearly' ? 'yearly' : 'monthly';
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Loading…';
    if (checkoutError) checkoutError.hidden = true;
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      showCheckoutError('Could not start checkout. Please try again.');
    } catch {
      showCheckoutError('Connection failed. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
});

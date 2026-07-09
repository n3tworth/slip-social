/* ============================================================
   SLIP SOCIAL — app-topbar-back.js
   Topbar "back" button — returns to the last page the visitor was
   actually on within Slip Social, regardless of which page they're
   currently on. Sitewide script, load AFTER app-core.js in the
   sitewide footer (doesn't depend on SlipSocial/Xano at all, but
   kept in the same load location for consistency). Self-gates if
   the button isn't on the page.

   Why not just window.history.back(): if someone arrived via an
   external link (email, search, a DM), plain history.back() would
   take them OFF the site entirely, not to "the last known page" the
   way this button is meant to behave. Instead: check document.referrer
   — the page that sent the visitor to whatever page they're currently
   on — and only use browser history if that referrer was actually
   part of this same site. Otherwise, land on a safe default page.
   ============================================================ */
(function () {
  'use strict';

  var btn = document.querySelector('[data-action="go-back"]');
  if (!btn) return;

  var FALLBACK_PATH = '/dashboard';

  btn.addEventListener('click', function (evt) {
    evt.preventDefault();

    var cameFromThisSite =
      document.referrer && document.referrer.indexOf(window.location.origin) === 0;

    if (cameFromThisSite && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = FALLBACK_PATH;
    }
  });
})();

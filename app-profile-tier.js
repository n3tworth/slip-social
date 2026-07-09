/* ============================================================
   SLIP SOCIAL — app-profile-tier.js
   Profile dropdown — logged-in member's capper tier display.
   Sitewide script (profile dropdown appears on every dashboard-area
   page), load AFTER app-core.js in the sitewide footer. Self-gates
   if the element isn't on the page, same convention as the other
   page-specific/sitewide scripts.

   Backend (Xano, Members group https://x8ki-letl-twmt.n7.xano.io/api:B6zsXs7-):
     GET /members/{memberstack_id} -> full member row (capper_tier
     confirmed present in the response). Auth retrofit to
     verify_member_token is tracked separately in Xano — doesn't
     change anything here, since SlipSocial.fetchXano() always attaches
     the caller's Bearer token regardless of whether the endpoint
     currently checks it.

   capper_tier comes back as raw snake_case: "", "free", "rookie",
   "lock_star", "sharp_shooter" — mapped to display labels below.
   Empty string means no tier assigned (every Tailer, and currently
   every seed member until one is populated for testing) — the
   element is hidden entirely in that case rather than showing a
   blank or placeholder label.

   Color-coding: text color is NOT set here. It's controlled by 4
   combo classes defined in Designer on this element (is-free,
   is-rookie, is-lock, is-sharp), each just setting Text Color to the
   matching brand variable (Dust, Blue, Sky, Chartreuse respectively).
   This script only toggles which one is present, per this project's
   convention of keeping color decisions in Designer, not hardcoded
   in JS.
   ============================================================ */
(function () {
  'use strict';

  var el = document.querySelector('[data-field="capper-tier"]');
  var S = window.SlipSocial;
  if (!el || !S) return;

  var TIER_LABELS = {
    free: 'Free',
    rookie: 'Rookie',
    lock_star: 'Lock-Star',
    sharp_shooter: 'Sharp Shooter'
  };

  // Xano value -> Designer combo class. lock_star/sharp_shooter collapse
  // to is-lock/is-sharp to match the shorter combo class names set up
  // in Designer (matches the mockup's existing ctb-lock/ctb-sharp pattern).
  var TIER_CLASSES = {
    free: 'is-free',
    rookie: 'is-rookie',
    lock_star: 'is-lock',
    sharp_shooter: 'is-sharp'
  };
  var ALL_TIER_CLASSES = ['is-free', 'is-rookie', 'is-lock', 'is-sharp'];

  S.getMemberstackId()
    .then(function (memberstackId) {
      return S.fetchXano('members/' + memberstackId);
    })
    .then(function (member) {
      var tier = member && member.capper_tier;

      // Always clear any previously applied tier class before reapplying —
      // safe even on first load, and keeps this idempotent if ever re-run.
      ALL_TIER_CLASSES.forEach(function (cls) {
        el.classList.remove(cls);
      });

      if (!tier) {
        // No tier assigned — Tailer, or a Capper/Hybrid with no tier set yet.
        el.style.display = 'none';
        return;
      }

      // Fall back to the raw value if it's ever something outside the known
      // four (capper_tier is a plain text column, not schema-enforced) —
      // surfacing an unexpected value is more useful than silently hiding it.
      el.textContent = TIER_LABELS[tier] || tier;

      var tierClass = TIER_CLASSES[tier];
      if (tierClass) el.classList.add(tierClass);
      // If tier is an unrecognized value, no combo class gets added —
      // label still shows (raw value), just without tier coloring.

      el.style.display = '';
    })
    .catch(function (err) {
      console.error('[capper-tier] load failed', err);
      el.style.display = 'none';
    });
})();

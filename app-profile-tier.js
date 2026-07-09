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

  S.getMemberstackId()
    .then(function (memberstackId) {
      return S.fetchXano('members/' + memberstackId);
    })
    .then(function (member) {
      var tier = member && member.capper_tier;

      if (!tier) {
        // No tier assigned — Tailer, or a Capper/Hybrid with no tier set yet.
        el.style.display = 'none';
        return;
      }

      // Fall back to the raw value if it's ever something outside the known
      // four (capper_tier is a plain text column, not schema-enforced) —
      // surfacing an unexpected value is more useful than silently hiding it.
      el.textContent = TIER_LABELS[tier] || tier;
      el.style.display = '';
    })
    .catch(function (err) {
      console.error('[capper-tier] load failed', err);
      el.style.display = 'none';
    });
})();

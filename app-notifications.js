/* ============================================================
   SLIP SOCIAL — app-notifications.js
   Dashboard Home notifications dropdown (page-specific).
   Load AFTER app-core.js, only on pages with the notif dropdown
   (early-return guard below, same convention as app-member-cards.js).

   Backend (Xano, Members group https://x8ki-letl-twmt.n7.xano.io/api:B6zsXs7-):
     GET  /notifications              -> { items: [...], unread_count: n }
     POST /notifications/mark-all-read -> { success: true, marked: n }
   Both expect "Authorization: Bearer <memberstack token>" — attached
   automatically by SlipSocial.fetchXano() (verified against app-core.js).

   Verified against app-core.js source:
     SlipSocial.getMemberstackId()  -> Promise<string>, REJECTS (not
       resolves-null) when no member is logged in. On this dashboard
       page that's effectively unreachable since the page itself is
       already Memberstack-gated, so the rejection just lands in
       load()'s catch — functionally fine, just noting the "not logged
       in" branch below is dead code in practice, not a bug.
     SlipSocial.fetchXano(path, opts?) -> matches as originally called
       here; no changes needed.
     SlipSocial.cloneAndFill(templateEl, data, fieldMap) -> Real signature
       is 3 args: a raw data object, plus a fieldMap keyed by CSS SELECTOR
       (not field name), whose values are either a property name to read
       off `data` or a function (el, data) => {...}. Fixed in buildRow()
       below (previous version called it with only 2 args).

   Second bug found (Xano confirmed returning real items; rows were being
   appended but staying invisible): when the Webflow HTML importer first
   brought in the template's `style="display:none"`, it auto-generated a
   combo class (e.g. "inline-article-0") whose only property is
   `display: none`, and attached it to the template element alongside the
   inline style. cloneNode(true) inside cloneAndFill copies that class onto
   every clone. Clearing `row.style.display = ''` only removes the INLINE
   style — the class-level `display:none` still wins, so rows sat in the
   DOM correctly filled with real data, just invisible. Fixed below by
   stripping any "inline-article-N" class off the clone. Matched by pattern
   rather than the exact name so this survives the template being rebuilt
   again with a different auto-generated number.
   ============================================================ */
(function () {
  'use strict';

  // --- Early-return guard: only run where the dropdown exists -------------
  // Dropdown wrapper was renamed in the Designer from .menu.menu-notif to
  // .dash-drop-menu.menu-notif (verified: dash-drop-menu carries the
  // original .menu properties). Targeting the data attribute so this
  // script survives any future class renames.
  var menu = document.querySelector('[data-menu="notif"]');
  var list = menu && menu.querySelector('[data-list="notifs"]');
  var S = window.SlipSocial;
  if (!menu || !list || !S) return;

  var template = list.querySelector('[data-template="true"]');
  if (!template) return;

  // Badge on the bell button (replaces the hardcoded "4")
  var badge = document.querySelector('[data-field="notif-unread-count"]');

  // "Mark all read" link — data-action="mark-all-read" is now on the
  // element in the Designer, so this resolves directly, no fallback needed.
  var markAllLink = menu.querySelector('[data-action="mark-all-read"]');

  // --- Relative time, matching the design's "2m ago" style ----------------
  function relTime(ms) {
    var diff = Math.max(0, Date.now() - Number(ms));
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 7) return d + 'd ago';
    return Math.floor(d / 7) + 'w ago';
  }

  // Strip any auto-generated "inline-article-N" hide-class the Webflow
  // HTML importer attached to the template (carries display:none as a
  // combo class, separate from the inline style we already clear).
  function stripInlineHideClass(el) {
    Array.prototype.slice.call(el.classList).forEach(function (cls) {
      if (/^inline-article-\d+$/.test(cls)) el.classList.remove(cls);
    });
  }

  // --- Row construction ----------------------------------------------------
  function buildRow(item) {
    // cloneAndFill(templateEl, data, fieldMap) — fieldMap keys are CSS
    // selectors, values are either a property name on `data` or a
    // function (el, data) => {...}. Passing `item` directly as `data`
    // so the selector->fieldname strings below read straight off it.
    var row = S.cloneAndFill(template, item, {
      '[data-field="notif-icon"]': 'icon',
      '[data-field="notif-title"]': 'title',
      '[data-field="notif-text"]': 'body',
      '[data-field="notif-time"]': function (el, data) {
        el.textContent = relTime(data.created_at);
      }
    });

    row.removeAttribute('data-template');
    row.style.display = '';
    stripInlineHideClass(row);
    applyReadState(row, item.is_read);
    return row;
  }

  // is-unread rides on notif_item as a combo class (native Webflow style);
  // the small dot next to the title shows only while unread.
  function applyReadState(row, isRead) {
    row.classList.toggle('is-unread', !isRead);
    var dot = row.querySelector('[data-field="notif-unread-dot"]');
    if (dot) dot.style.display = isRead ? 'none' : '';
  }

  function setBadge(count) {
    if (!badge) return;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
  }

  // --- Render --------------------------------------------------------------
  function render(payload) {
    // Clear filler rows from the static build and any previous render;
    // the hidden template row stays put for future renders.
    list.querySelectorAll('.notif_item:not([data-template])').forEach(function (el) {
      el.remove();
    });

    (payload.items || []).forEach(function (item) {
      list.appendChild(buildRow(item));
    });

    setBadge(payload.unread_count || 0);
  }

  // --- Mark all read: flip UI in place, no reload --------------------------
  function markAllRead(evt) {
    if (evt) evt.preventDefault();
    Promise.resolve(S.fetchXano('/notifications/mark-all-read', { method: 'POST' }))
      .then(function () {
        list.querySelectorAll('.notif_item:not([data-template])').forEach(function (row) {
          applyReadState(row, true);
        });
        setBadge(0);
      })
      .catch(function (err) {
        console.error('[notifications] mark-all-read failed', err);
      });
  }

  // --- Load ----------------------------------------------------------------
  function load() {
    Promise.resolve(S.getMemberstackId())
      .then(function (memberstackId) {
        if (!memberstackId) return null; // effectively unreachable — see header note
        return Promise.resolve(S.fetchXano('/notifications')).then(render);
      })
      .catch(function (err) {
        console.error('[notifications] load failed', err);
      });
  }

  if (markAllLink) markAllLink.addEventListener('click', markAllRead);
  load();
})();

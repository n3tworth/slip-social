/* app-post-editor.js
   Full composer engine for Slip Social's Create-a-post modal (Social live now;
   House/Community reuse the same functions once they carry matching attributes).

   Sections:
     1. Rich text toolbar (markdown wrap/prefix commands)
     2. Segmented groups (visibility control + reused for slip sort)
     3. Media carousel (10 shared slots: photo/video/sticker/klipy_gif/slip)
     4. Action-button panel switching (photo/video -> slots, others -> pickers)
     5. Photo/video upload + oversized-file warning
     6. Sticker picker (in-house GIF presets, client-side keyword search)
     7. Klipy picker (external GIF search) -- see NOTE near KLIPY_* below
     8. Slip picker (capper's own slips, last 14 days, filter + sort)
     9. Schedule toggle + native datetime input
    10. Publish / Cancel / Save-to-Drafts + autosave

   NOTE ON KLIPY: search endpoint confirmed from Nikol's Partner Panel code
   sample: GET /gifs/search?page&per_page&q&customer_id&locale&content_filter
   (customer_id is a query param, not a path segment -- an earlier version
   of this file had that wrong, which caused two consecutive empty 204
   responses before the real endpoint was confirmed). Memes/Stickers/Clips
   endpoints are presumed to follow the identical pattern with the content
   type swapped in the path (e.g. /memes/search) -- not yet independently
   confirmed, worth checking the Partner Panel if/when those get built.
*/
(function () {
  if (window.SlipSocial && window.SlipSocial.postEditorLoaded) return;
  window.SlipSocial = window.SlipSocial || {};
  window.SlipSocial.postEditorLoaded = true;

  var KLIPY_API_KEY = 'gK29wMsQq1Fn8DG1gTXeR3zokTngrLb0PKpDgnb2HvTUiT9d6GhAH10n39ibyrif';
  var MAX_MEDIA_ITEMS = 10;
  var MAX_SLIPS = 3;
  var MAX_IMAGE_MB = 10;
  var MAX_VIDEO_MB = 100;
  var AUTOSAVE_DELAY_MS = 4000; // generous on purpose -- Xano free plan rate-limits at 10 req/20s

  // ============================================================
  // Composer state -- one object per scope ("social", later "house"/"community")
  // ============================================================
  var states = {};
  function getState(scope) {
    if (!states[scope]) {
      states[scope] = {
        mediaItems: [],       // {type, url, ref_id, text, result, posted_at}
        draftId: null,
        autosaveTimer: null,
        stickerCache: null,   // gif_presets rows, fetched once
        slipCache: null,      // this capper's slips, fetched once per picker-open
        slipFilters: {},      // e.g. {won:true} -- empty means "show all"
        slipSort: 'desc',
        scheduleOn: false
      };
    }
    return states[scope];
  }

  // ============================================================
  // 1. Rich text toolbar
  // ============================================================
  var CMDS = {
    bold:    { wrap: '**' },
    italic:  { wrap: '*' },
    strike:  { wrap: '~~' },
    heading: { prefix: '# ' },
    h1:      { prefix: '# ' },
    h2:      { prefix: '## ' },
    list:    { prefix: '- ' },
    quote:   { prefix: '> ' },
    link:    { link: true }
  };

  function initToolbar(toolbarEl) {
    var scope = toolbarEl.getAttribute('data-editor-toolbar');
    var target = document.querySelector('[data-editor-target="' + scope + '"]');
    if (!target) return;

    setupPlaceholder(target);
    target.addEventListener('input', function () { scheduleAutosave(scope); });

    toolbarEl.querySelectorAll('[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        applyCmd(target, btn.getAttribute('data-cmd'));
      });
    });
  }

  function setupPlaceholder(target) {
    function refresh() {
      target.classList.toggle('is-empty', target.textContent.trim() === '');
    }
    target.addEventListener('input', refresh);
    target.addEventListener('blur', refresh);
    refresh();

    if (!document.getElementById('slip-editor-placeholder-style')) {
      var style = document.createElement('style');
      style.id = 'slip-editor-placeholder-style';
      style.textContent =
        '[data-editor-target].is-empty:before{content:attr(data-placeholder);color:var(--ss-dust,#D6D6D6);pointer-events:none;}';
      document.head.appendChild(style);
    }
  }

  function getRange(target) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    return target.contains(range.commonAncestorContainer) ? range : null;
  }

  function applyCmd(target, cmd) {
    target.focus();
    var config = CMDS[cmd];
    if (!config) return;
    var range = getRange(target);

    if (config.wrap) {
      wrapSelection(target, range, config.wrap);
    } else if (config.prefix) {
      insertText_(target, range, config.prefix, config.prefix.length, config.prefix.length);
    } else if (config.link) {
      insertLink(target, range);
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wrapSelection(target, range, marker) {
    var hasSelection = range && !range.collapsed;
    var text = hasSelection ? range.toString() : 'text';
    var insertTextStr = marker + text + marker;
    insertText_(target, range, insertTextStr, marker.length, insertTextStr.length - marker.length);
  }

  function insertLink(target, range) {
    var url = window.prompt('Link URL:');
    if (!url) return;
    var hasSelection = range && !range.collapsed;
    var text = hasSelection ? range.toString() : 'link text';
    var insertTextStr = '[' + text + '](' + url + ')';
    insertText_(target, range, insertTextStr, insertTextStr.length, insertTextStr.length);
  }

  function insertText_(target, range, text, selStart, selEnd) {
    var workingRange = range;
    if (!workingRange) {
      workingRange = document.createRange();
      workingRange.selectNodeContents(target);
      workingRange.collapse(false);
    }
    workingRange.deleteContents();
    var node = document.createTextNode(text);
    workingRange.insertNode(node);

    var sel = window.getSelection();
    var newRange = document.createRange();
    newRange.setStart(node, Math.min(selStart, node.length));
    newRange.setEnd(node, Math.min(selEnd, node.length));
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  // ============================================================
  // 2. Segmented groups (visibility control; reused as-is for slip sort)
  // ============================================================
  function initSegmentedGroups() {
    document.querySelectorAll('[data-seg-group]').forEach(function (group) {
      var btns = group.querySelectorAll('.seg_btn');
      btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          btns.forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          group.setAttribute('data-selected', btn.getAttribute('data-seg-value') || '');
          group.dispatchEvent(new CustomEvent('segchange', { bubbles: true }));
        });
      });
      var initiallyActive = group.querySelector('.seg_btn.is-active');
      if (initiallyActive) {
        group.setAttribute('data-selected', initiallyActive.getAttribute('data-seg-value') || '');
        group.setAttribute('data-original-default', initiallyActive.getAttribute('data-seg-value') || '');
      }
    });
  }

  // ============================================================
  // 3. Media carousel -- shared 10 slots
  // ============================================================
  function initMediaSlots() {
    document.querySelectorAll('[data-slot-container]').forEach(function (container) {
      var template = container.querySelector('[data-slot-template]');
      if (!template) return;

      for (var i = 1; i < MAX_MEDIA_ITEMS; i++) {
        var clone = template.cloneNode(true);
        clone.removeAttribute('data-slot-template');
        container.appendChild(clone);
      }
      // number every slot 1-10, template included as slot 1
      var slots = container.children;
      for (var idx = 0; idx < slots.length; idx++) {
        var orderField = slots[idx].querySelector('[data-field="media-slot-order"]');
        if (orderField) orderField.textContent = String(idx + 1);
        var removeBtn = slots[idx].querySelector('.data-slot-remove');
        if (removeBtn) removeBtn.style.display = 'none'; // no longer clickable -- removal happens by clicking the media itself
      }
    });
  }

  function getSlotsContainer(scope) {
    return document.querySelector('[data-slot-container="' + scope + '"]'); // inner flex row-wrap -- clone/fill target
  }

  function renderSlots(scope) {
    var state = getState(scope);
    var container = getSlotsContainer(scope);
    if (!container) return;
    var slots = container.children;
    for (var i = 0; i < slots.length; i++) {
      fillSlot(slots[i], state.mediaItems[i], scope, i);
    }
  }

  function fillSlot(slotEl, item, scope, index) {
    var orderField = slotEl.querySelector('[data-field="media-slot-order"]');
    var labelField = slotEl.querySelector('[data-field="media-slot-label"]');
    var removeBtn = slotEl.querySelector('.data-slot-remove');
    var injected = slotEl.querySelector('[data-injected-media]');
    if (injected) injected.remove();

    if (!item) {
      if (orderField) orderField.style.display = '';
      if (labelField) labelField.style.display = '';
      if (removeBtn) removeBtn.style.display = 'none';
      return;
    }

    if (labelField) labelField.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'none'; // no longer the removal trigger -- clicking the media itself is now

    var mediaEl;
    if (item.type === 'slip' && !item.url) {
      mediaEl = document.createElement('div');
      mediaEl.textContent = item.text || '';
    } else if (item.type === 'video') {
      mediaEl = document.createElement('video');
      mediaEl.src = item.url;
      mediaEl.muted = true;
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = item.url;
    }
    mediaEl.classList.add('data-slot');
    mediaEl.setAttribute('data-injected-media', 'true');
    mediaEl.style.cursor = 'pointer';
    // Absolute overlay covering the slot edge-to-edge, rather than a normal
    // flex child subject to the box's own layout (padding/centering/etc) --
    // that mismatch is very likely why the image looked "styled" instead of
    // replacing the template underneath. Requires the slot itself to have
    // position:relative in Designer (see note below).
    mediaEl.style.position = 'absolute';
    mediaEl.style.inset = '0';
    mediaEl.style.width = '100%';
    mediaEl.style.height = '100%';
    mediaEl.style.objectFit = 'contain'; // lineup wants contain; sticker picker's own grid keeps cover via its class
    mediaEl.style.zIndex = '1';
    mediaEl.addEventListener('click', function () {
      removeMediaItem(scope, index);
    });
    slotEl.appendChild(mediaEl);
  }

  function addMediaItem(scope, item) {
    var state = getState(scope);
    if (state.mediaItems.length >= MAX_MEDIA_ITEMS) return false;
    if (item.type === 'slip') {
      var slipCount = state.mediaItems.filter(function (m) { return m.type === 'slip'; }).length;
      if (slipCount >= MAX_SLIPS) return false;
    }
    state.mediaItems.push(item);
    renderSlots(scope);
    scheduleAutosave(scope);
    return true;
  }

  function removeMediaItem(scope, index) {
    var state = getState(scope);
    var removed = state.mediaItems[index];
    state.mediaItems.splice(index, 1);
    renderSlots(scope);
    scheduleAutosave(scope);
    // if it was a sticker or slip, clear its is-active state back in the picker
    if (removed && removed.type === 'sticker') syncStickerActiveStates(scope);
    if (removed && removed.type === 'slip') syncSlipActiveStates(scope);
  }

  function mediaCapReached(scope, type) {
    var state = getState(scope);
    if (state.mediaItems.length >= MAX_MEDIA_ITEMS) return true;
    if (type === 'slip') {
      var slipCount = state.mediaItems.filter(function (m) { return m.type === 'slip'; }).length;
      return slipCount >= MAX_SLIPS;
    }
    return false;
  }

  // ============================================================
  // 4. Action-button panel switching
  // ============================================================
  function initMediaTypeSwitching() {
    document.querySelectorAll('[data-media-trigger]').forEach(function (btn) {
      var scope = btn.getAttribute('data-media-trigger');
      var type = btn.getAttribute('data-media-type');
      if (!type) return; // photo/video file-input triggers handled entirely in initMediaUpload now

      if (type === 'sticker') {
        btn.addEventListener('click', function () { showPanel(scope, 'sticker'); });
      } else if (type === 'gif') {
        btn.addEventListener('click', function () { showPanel(scope, 'klipy'); });
      } else if (type === 'slip') {
        btn.addEventListener('click', function () { showPanel(scope, 'slip'); });
      }
      // photo/video: no panel to show anymore -- the 10 slots are always visible now
    });
  }

  function showPanel(scope, which) {
    var panels = {
      sticker: document.querySelector('[data-sticker-picker="' + scope + '"]'),
      klipy: document.querySelector('[data-klipy-picker="' + scope + '"]'),
      slip: document.querySelector('[data-slip-picker="' + scope + '"]')
    };
    var target = panels[which];
    var alreadyOpen = target && target.classList.contains('is-visible');

    Object.keys(panels).forEach(function (key) {
      var el = panels[key];
      if (!el) return;
      // if the clicked panel was already open, close everything (second click = close);
      // otherwise show only the clicked one, hide the other two
      el.classList.toggle('is-visible', !alreadyOpen && key === which);
    });

    // Scroll the media lineup into view on open (not close), so the user
    // can see items land as they click through stickers/GIFs/slips.
    if (!alreadyOpen) {
      var lineup = document.getElementById('media-lineup');
      if (lineup) {
        lineup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        console.warn('#media-lineup not found -- add that id to the carousel/lineup element for auto-scroll to work.');
      }
    }
  }

  // ============================================================
  // 5. Photo/video upload
  // ============================================================
  function initMediaUpload() {
    document.querySelectorAll('[data-media-trigger]').forEach(function (btn) {
      var scope = btn.getAttribute('data-media-trigger');
      var type = btn.getAttribute('data-media-type');
      if (type !== 'photo') return; // single combined photo/video trigger now

      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*,video/*';
      fileInput.multiple = true;
      fileInput.style.display = 'none';
      // Appended to body rather than inside btn -- a hidden input nested inside
      // an interactive element (often an <a> in Webflow) can silently fail to
      // forward .click() in some browsers. Keeping it detached and separate is
      // the more reliable pattern, and is very possibly why file selection
      // wasn't opening before.
      document.body.appendChild(fileInput);

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (mediaCapReached(scope)) { showMediaWarning(scope, 'Max 10 items reached.'); return; }
        fileInput.click();
      });

      fileInput.addEventListener('change', function () {
        Array.prototype.forEach.call(fileInput.files, function (file) {
          var actualType = file.type.indexOf('video') === 0 ? 'video' : 'photo';
          handleUpload(scope, file, actualType);
        });
        fileInput.value = '';
      });
    });
  }

  function handleUpload(scope, file, type) {
    if (type === 'video') {
      // Xano's free plan doesn't support video storage yet (image storage
      // does) -- checked client-side to avoid a wasted round-trip; server
      // enforces this too, so this stays correct even if bypassed.
      showMediaWarning(scope, 'Video uploads aren\'t available yet.');
      return;
    }

    var maxMB = MAX_IMAGE_MB;
    if (file.size > maxMB * 1024 * 1024) {
      showMediaWarning(scope, 'File too large (max ' + maxMB + 'MB)');
      return;
    }
    if (mediaCapReached(scope)) { showMediaWarning(scope, 'Max 10 items reached.'); return; }

    var formData = new FormData();
    formData.append('file', file);

    window.SlipSocial.fetchXano('/media-upload', { method: 'POST', body: formData })
      .then(function (res) {
        addMediaItem(scope, { type: type, url: res.url, ref_id: null, text: null, result: null, posted_at: null });
      })
      .catch(function (err) {
        console.error('Upload failed', err);
        // Surface Xano's actual message when there is one, rather than a
        // generic string that hides what really happened.
        showMediaWarning(scope, (err && err.message) ? err.message.replace('[SlipSocial] ', '') : 'Upload failed, try again.');
      });
  }

  function showMediaWarning(scope, message) {
    var el = document.querySelector('[data-media-warning="' + scope + '"]');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 4000);
  }

  // ============================================================
  // 6. Sticker picker (in-house presets, client-side keyword search)
  // ============================================================
  function initStickerPicker() {
    document.querySelectorAll('[data-sticker-picker]').forEach(function (panel) {
      var scope = panel.getAttribute('data-sticker-picker');
      var template = panel.querySelector('[data-sticker-item-template]');
      var searchWrap = document.querySelector('[data-sticker-search="' + scope + '"]');
      if (!template) return;
      template.style.display = 'none';

      var input = null;
      if (searchWrap) {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Search stickers';
        input.style.background = 'transparent';
        input.style.border = 'none';
        input.style.outline = 'none';
        searchWrap.appendChild(input);
        input.addEventListener('input', function () {
          renderStickers(scope, input.value.trim().toLowerCase());
        });
      }

      // Fetch once, lazily, the first time this panel is shown
      panel.addEventListener('transitionend', function () {}); // no-op, kept for future use
      var observer = new MutationObserver(function () {
        if (panel.classList.contains('is-visible') && !getState(scope).stickerCache) {
          window.SlipSocial.fetchXano('/gif-presets', { method: 'GET' })
            .then(function (res) {
              getState(scope).stickerCache = res.items || res || [];
              renderStickers(scope, '');
            })
            .catch(function (err) { console.error('Failed to load stickers', err); });
        }
      });
      observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function renderStickers(scope, query) {
    var panel = document.querySelector('[data-sticker-picker="' + scope + '"]');
    var template = panel.querySelector('[data-sticker-item-template]');
    var cache = getState(scope).stickerCache || [];
    panel.querySelectorAll('[data-injected-sticker]').forEach(function (el) { el.remove(); });

    var filtered = cache.filter(function (row) {
      if (!query) return true;
      return (row.keywords || '').toLowerCase().indexOf(query) !== -1;
    });

    filtered.forEach(function (row) {
      var clone = template.cloneNode(true);
      clone.removeAttribute('data-sticker-item-template');
      clone.setAttribute('data-injected-sticker', 'true');
      clone.setAttribute('data-sticker-id', row.id);
      clone.style.display = '';
      clone.style.cursor = 'pointer';
      clone.style.position = clone.style.position || 'relative'; // needed for the absolute image below

      // Same issue as the carousel slots had: the template box likely has no
      // real <img> tag inside it (just an empty placeholder div), so create
      // one fresh each time rather than assuming one exists to set .src on.
      var img = document.createElement('img');
      img.src = row.gif_url;
      img.classList.add('data-slot'); // reuse the same object-fit:cover treatment
      img.style.position = 'absolute';
      img.style.inset = '0';
      img.style.width = '100%';
      img.style.height = '100%';
      clone.appendChild(img);

      clone.addEventListener('click', function () {
        var state = getState(scope);
        var existingIndex = state.mediaItems.findIndex(function (m) { return m.type === 'sticker' && m.ref_id === String(row.id); });
        if (existingIndex !== -1) {
          removeMediaItem(scope, existingIndex);
        } else {
          if (mediaCapReached(scope)) { showMediaWarning(scope, 'Max 10 items reached.'); return; }
          addMediaItem(scope, { type: 'sticker', url: row.gif_url, ref_id: String(row.id), text: null, result: null, posted_at: null });
        }
        syncStickerActiveStates(scope);
      });

      template.parentNode.appendChild(clone);
    });
    syncStickerActiveStates(scope);
  }

  function syncStickerActiveStates(scope) {
    var panel = document.querySelector('[data-sticker-picker="' + scope + '"]');
    if (!panel) return;
    var chosenIds = getState(scope).mediaItems
      .filter(function (m) { return m.type === 'sticker'; })
      .map(function (m) { return m.ref_id; });
    panel.querySelectorAll('[data-injected-sticker]').forEach(function (el) {
      el.classList.toggle('is-active', chosenIds.indexOf(el.getAttribute('data-sticker-id')) !== -1);
    });
  }

  // ============================================================
  // 7. Klipy picker (external GIF search)
  // ============================================================
  function initKlipyPicker() {
    document.querySelectorAll('[data-klipy-picker]').forEach(function (panel) {
      var scope = panel.getAttribute('data-klipy-picker');
      var searchWrap = document.querySelector('[data-klipy-search="' + scope + '"]');
      var results = document.querySelector('[data-klipy-results="' + scope + '"]');
      if (!searchWrap || !results) {
        console.warn('Klipy panel found but data-klipy-search or data-klipy-results element is missing for scope "' + scope + '"');
        return;
      }

      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Search KLIPY'; // required attribution wording per Klipy's brand guidelines
      input.style.background = 'transparent';
      input.style.border = 'none';
      input.style.outline = 'none';
      searchWrap.appendChild(input);

      var debounceTimer = null;
      input.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        var q = input.value.trim();
        debounceTimer = setTimeout(function () {
          if (q) {
            searchKlipy(scope, q, results);
          } else {
            loadDefaultKlipyView(scope, results); // empty search box -- Recent, falling back to Trending
          }
        }, 400);
      });

      // Load the default view (Recent -> Trending) the first time this
      // panel becomes visible, before anyone's typed anything.
      var loadedDefault = false;
      var observer = new MutationObserver(function () {
        if (panel.classList.contains('is-visible') && !loadedDefault && !input.value.trim()) {
          loadedDefault = true;
          console.log('[Klipy] panel opened, loading default view for scope "' + scope + '"');
          loadDefaultKlipyView(scope, results);
        }
      });
      observer.observe(panel, { attributes: true, attributeFilter: ['class'] });

      // In case the panel is already visible at init time (e.g. is-visible
      // was left on in Designer during testing), the class-change observer
      // above wouldn't fire since nothing changes -- check once up front too.
      if (panel.classList.contains('is-visible') && !loadedDefault) {
        loadedDefault = true;
        loadDefaultKlipyView(scope, results);
      }
    });
  }

  function getMemberstackIdOrAnon() {
    return window.SlipSocial.getMemberstackId
      ? window.SlipSocial.getMemberstackId().catch(function () { return 'anon'; })
      : Promise.resolve('anon');
  }

  // Low-level fetch + parse, shared by Recent/Trending/Search. Returns a
  // Promise of the raw parsed response (or null for a 204/empty body).
  function fetchKlipyJson(url) {
    console.log('[Klipy] requesting', url);
    return fetch(url, { headers: { 'Content-Type': 'application/json' } }).then(function (r) {
      console.log('[Klipy] response status', r.status, 'for', url);
      if (r.status === 204) return null;
      if (!r.ok) throw new Error('Klipy request failed with status ' + r.status);
      return r.json();
    });
  }

  function extractKlipyItems(data) {
    return (data && data.data && data.data.data) || [];
  }

  // Recent -> Trending cascade, per the intended default-view order.
  function loadDefaultKlipyView(scope, resultsEl) {
    getMemberstackIdOrAnon().then(function (customerId) {
      var recentUrl = 'https://api.klipy.com/api/v1/' + KLIPY_API_KEY + '/gifs/recent/' + encodeURIComponent(customerId)
        + '?page=1&per_page=24';
      return fetchKlipyJson(recentUrl).then(function (data) {
        var items = extractKlipyItems(data);
        if (items.length > 0) {
          console.log('[Klipy] showing Recent,', items.length, 'items');
          renderKlipyItemList(items, scope, resultsEl);
        } else {
          console.log('[Klipy] Recent was empty, falling back to Trending');
          return loadTrendingGifs(scope, resultsEl);
        }
      });
    }).catch(function (err) {
      console.error('[Klipy] Recent failed, falling back to Trending', err);
      return loadTrendingGifs(scope, resultsEl);
    });
  }

  function loadTrendingGifs(scope, resultsEl) {
    return getMemberstackIdOrAnon().then(function (customerId) {
      // Confirmed from Partner Panel: customer_id is a query param here
      // (same convention as Search).
      var url = 'https://api.klipy.com/api/v1/' + KLIPY_API_KEY + '/gifs/trending'
        + '?customer_id=' + encodeURIComponent(customerId)
        + '&page=1&per_page=24';
      return fetchKlipyJson(url);
    }).then(function (data) {
      var items = extractKlipyItems(data);
      console.log('[Klipy] showing Trending,', items.length, 'items');
      renderKlipyItemList(items, scope, resultsEl);
    }).catch(function (err) {
      console.error('[Klipy] Trending also failed', err);
      resultsEl.innerHTML = '';
    });
  }

  function searchKlipy(scope, query, resultsEl) {
    if (!query) { loadDefaultKlipyView(scope, resultsEl); return; }

    getMemberstackIdOrAnon().then(function (customerId) {
      // Confirmed from Partner Panel: customer_id is a query param here.
      var url = 'https://api.klipy.com/api/v1/' + KLIPY_API_KEY + '/gifs/search'
        + '?q=' + encodeURIComponent(query)
        + '&customer_id=' + encodeURIComponent(customerId)
        + '&page=1&per_page=24';
      return fetchKlipyJson(url);
    }).then(function (data) {
      renderKlipyItemList(extractKlipyItems(data), scope, resultsEl);
    }).catch(function (err) {
      console.error('[Klipy] Search failed', err);
    });
  }

  // Shared rendering, given an already-extracted items array.
  function renderKlipyItemList(items, scope, resultsEl) {
    resultsEl.innerHTML = '';
    items.forEach(function (item) {
      if (!item.file) return;
      var thumbUrl = item.file.sm && item.file.sm.gif && item.file.sm.gif.url;
      var fullUrl = (item.file.md && item.file.md.gif && item.file.md.gif.url) ||
        (item.file.hd && item.file.hd.gif && item.file.hd.gif.url) || thumbUrl;
      if (!thumbUrl) return;

      var img = document.createElement('img');
      img.src = thumbUrl;
      img.style.cursor = 'pointer';
      img.addEventListener('click', function () {
        if (mediaCapReached(scope)) { showMediaWarning(scope, 'Max 10 items reached.'); return; }
        addMediaItem(scope, { type: 'klipy_gif', url: fullUrl, ref_id: item.id ? String(item.id) : null, text: null, result: null, posted_at: null });
      });
      resultsEl.appendChild(img);
    });
  }

  // ============================================================
  // 8. Slip picker (capper's own slips, last 14 days)
  // ============================================================
  function initSlipPicker() {
    document.querySelectorAll('[data-slip-picker]').forEach(function (panel) {
      var scope = panel.getAttribute('data-slip-picker');
      var template = panel.querySelector('[data-slip-item-template]') || panel.querySelector('[data-slip-text]')?.closest('[data-slip-item-template]');

      // filter chips -- independent multi-toggle
      var filterWrap = document.querySelector('[data-slip-filter="' + scope + '"]');
      if (filterWrap) {
        filterWrap.querySelectorAll('[data-filter-value]').forEach(function (chip) {
          chip.addEventListener('click', function () {
            var val = chip.getAttribute('data-filter-value');
            var state = getState(scope);
            chip.classList.toggle('is-active');
            if (chip.classList.contains('is-active')) {
              state.slipFilters[val] = true;
            } else {
              delete state.slipFilters[val];
            }
            renderSlips(scope);
          });
        });
      }

      // sort -- reuses the generic seg-group listener already wired by
      // initSegmentedGroups(), just listen for its change event here
      var sortGroup = document.querySelector('[data-seg-group="slip-sort"]');
      if (sortGroup) {
        sortGroup.addEventListener('segchange', function () {
          getState(scope).slipSort = sortGroup.getAttribute('data-selected') || 'desc';
          renderSlips(scope);
        });
      }

      var observer = new MutationObserver(function () {
        if (panel.classList.contains('is-visible') && !getState(scope).slipCache) {
          window.SlipSocial.fetchXano('/slips/mine', { method: 'GET' })
            .then(function (res) {
              getState(scope).slipCache = res.items || res || [];
              renderSlips(scope);
            })
            .catch(function (err) { console.error('Failed to load slips', err); });
        }
      });
      observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // Xano's slips.result uses pending/win/loss/push/void; the composer's
  // filter chips and badges use won/pending/lost per the original spec.
  // win/loss map cleanly. push and void are deliberately NOT forced into
  // won/lost -- a push (tie/refund) or void (cancelled) bet is neither a
  // win nor a loss, and mislabeling one would misrepresent an actual
  // record. They pass through under their own raw label instead; only
  // won/pending/lost have dedicated filter chips today; flag to Nikol'
  // if push/void need their own chips added later.
  function mapSlipResult(raw) {
    if (raw === 'win') return 'won';
    if (raw === 'loss') return 'lost';
    if (raw === 'pending') return 'pending';
    return raw; // push, void -- shown as-is, not filterable by the three chips
  }

  function renderSlips(scope) {
    var panel = document.querySelector('[data-slip-picker="' + scope + '"]');
    if (!panel) return;
    var template = panel.querySelector('[data-slip-item-template]');
    if (!template) return;
    var state = getState(scope);
    var cache = state.slipCache || [];

    var activeFilters = Object.keys(state.slipFilters);
    var filtered = cache.filter(function (row) {
      if (activeFilters.length === 0) return true;
      return activeFilters.indexOf(mapSlipResult(row.result)) !== -1;
    });

    filtered.sort(function (a, b) {
      var da = new Date(a.created_at).getTime();
      var db = new Date(b.created_at).getTime();
      return state.slipSort === 'asc' ? da - db : db - da;
    });

    panel.querySelectorAll('[data-injected-slip]').forEach(function (el) { el.remove(); });
    template.style.display = 'none';

    var emptyEl = document.querySelector('[data-slip-empty="' + scope + '"]');
    var emptyTextEl = emptyEl ? emptyEl.querySelector('[data-slip-empty-text]') : null;
    var emptyLinkEl = emptyEl ? emptyEl.querySelector('[data-slip-empty-link]') : null;
    if (emptyEl) {
      if (cache.length === 0) {
        if (emptyTextEl) emptyTextEl.textContent = 'No recent slips to show. Try adding one...';
        if (emptyLinkEl) emptyLinkEl.style.display = ''; // only makes sense when there are truly zero slips
        emptyEl.style.display = '';
      } else if (filtered.length === 0) {
        if (emptyTextEl) emptyTextEl.textContent = 'No slips match this filter.';
        if (emptyLinkEl) emptyLinkEl.style.display = 'none'; // adding a slip won't fix a filter mismatch
        emptyEl.style.display = '';
      } else {
        emptyEl.style.display = 'none';
      }
    }

    filtered.forEach(function (row) {
      var clone = template.cloneNode(true);
      clone.removeAttribute('data-slip-item-template');
      clone.setAttribute('data-injected-slip', 'true');
      clone.setAttribute('data-slip-id', row.id);
      clone.style.display = '';
      clone.style.cursor = 'pointer';

      var img = clone.querySelector('.data-slot');
      var textEl = clone.querySelector('[data-slip-text]');
      var resultEl = clone.querySelector('[data-slip-result]');
      var dateEl = clone.querySelector('[data-slip-date]');
      var mappedResult = mapSlipResult(row.result);

      if (row.slip_image_url) {
        if (img) { img.src = row.slip_image_url; img.style.display = ''; }
        if (textEl) textEl.style.display = 'none';
      } else {
        if (img) img.style.display = 'none';
        if (textEl) { textEl.textContent = row.pick || ''; textEl.style.display = ''; }
      }
      if (resultEl) {
        resultEl.textContent = mappedResult;
        resultEl.setAttribute('data-filter-value', mappedResult); // drives the shared color CSS
      }
      if (dateEl) dateEl.textContent = row.created_at || '';

      clone.addEventListener('click', function () {
        var existingIndex = state.mediaItems.findIndex(function (m) { return m.type === 'slip' && m.ref_id === String(row.id); });
        if (existingIndex !== -1) {
          removeMediaItem(scope, existingIndex);
        } else {
          if (mediaCapReached(scope, 'slip')) { showMediaWarning(scope, 'Max 3 slips per post.'); return; }
          addMediaItem(scope, {
            type: 'slip', url: row.slip_image_url || null, ref_id: String(row.id),
            text: row.slip_image_url ? null : (row.pick || ''),
            result: mappedResult, posted_at: row.created_at
          });
        }
        syncSlipActiveStates(scope);
      });

      template.parentNode.appendChild(clone);
    });
    syncSlipActiveStates(scope);
  }

  function syncSlipActiveStates(scope) {
    var panel = document.querySelector('[data-slip-picker="' + scope + '"]');
    if (!panel) return;
    var chosenIds = getState(scope).mediaItems
      .filter(function (m) { return m.type === 'slip'; })
      .map(function (m) { return m.ref_id; });
    panel.querySelectorAll('[data-injected-slip]').forEach(function (el) {
      el.classList.toggle('is-active', chosenIds.indexOf(el.getAttribute('data-slip-id')) !== -1);
    });
  }

  // ============================================================
  // 9. Schedule toggle + datetime input
  // ============================================================
  function initSchedule() {
    document.querySelectorAll('[data-schedule-toggle]').forEach(function (toggle) {
      var scope = toggle.getAttribute('data-schedule-toggle');
      var dtWrap = document.querySelector('[data-schedule-datetime="' + scope + '"]');
      var input = null;
      if (dtWrap) {
        input = document.createElement('input');
        input.type = 'datetime-local';
        dtWrap.appendChild(input);
        dtWrap.style.display = 'none';
      }

      toggle.addEventListener('click', function () {
        var state = getState(scope);
        state.scheduleOn = !state.scheduleOn;
        toggle.classList.toggle('is-active', state.scheduleOn);
        if (dtWrap) dtWrap.style.display = state.scheduleOn ? '' : 'none';
      });
    });
  }

  // ============================================================
  // 10. Publish / Cancel / Save-to-Drafts + autosave
  // ============================================================
  function initPublishCancelDraft() {
    document.querySelectorAll('[data-publish-trigger]').forEach(function (btn) {
      var scope = btn.getAttribute('data-publish-trigger');
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        publish(scope);
      });
    });
    document.querySelectorAll('[data-save-draft-trigger]').forEach(function (btn) {
      var scope = btn.getAttribute('data-save-draft-trigger');
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        savePost(scope, 'draft', true);
      });
    });
    document.querySelectorAll('[data-cancel-trigger]').forEach(function (btn) {
      var scope = btn.getAttribute('data-cancel-trigger');
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        cancelComposer(scope);
      });
    });
  }

  function buildPayload(scope, status) {
    var target = document.querySelector('[data-editor-target="' + scope + '"]');
    var visGroup = document.querySelector('[data-seg-group]'); // visibility control -- only one per Social composer currently
    var state = getState(scope);

    var payload = {
      content: target ? target.textContent : '',
      media_items: state.mediaItems,
      status: status
    };
    if (visGroup) payload.visibility = visGroup.getAttribute('data-selected');

    if (state.scheduleOn) {
      var dtInput = document.querySelector('[data-schedule-datetime="' + scope + '"] input');
      if (dtInput && dtInput.value) payload.scheduled_at = new Date(dtInput.value).toISOString();
    }
    return payload;
  }

  function savePost(scope, status, isManual) {
    var state = getState(scope);
    var payload = buildPayload(scope, status);
    var isCreate = !state.draftId;
    var endpoint = isCreate ? '/social-posts' : '/social-posts/' + state.draftId;
    var method = isCreate ? 'POST' : 'PATCH';

    return window.SlipSocial.fetchXano(endpoint, { method: method, body: JSON.stringify(payload) })
      .then(function (res) {
        if (isCreate && res && res.id) state.draftId = res.id;
        return res;
      })
      .catch(function (err) {
        console.error((isManual ? 'Save' : 'Autosave') + ' failed', err);
      });
  }

  function scheduleAutosave(scope) {
    var state = getState(scope);
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(function () {
      savePost(scope, 'draft', false);
    }, AUTOSAVE_DELAY_MS);
  }

  function publish(scope) {
    var state = getState(scope);
    var status = state.scheduleOn ? 'scheduled' : 'published';
    savePost(scope, status, true).then(function () {
      closeComposer(scope);
    });
  }

  function cancelComposer(scope) {
    var state = getState(scope);
    if (state.draftId) {
      window.SlipSocial.fetchXano('/social-posts/' + state.draftId, { method: 'DELETE' })
        .catch(function (err) { console.error('Draft delete failed', err); });
    }
    resetComposerUI(scope); // unconditional -- clears visibly even if #close-post fails silently
    closeComposer(scope);
  }

  function resetComposerUI(scope) {
    var state = getState(scope);
    state.mediaItems = [];
    state.draftId = null;
    state.scheduleOn = false;
    state.slipFilters = {};
    clearTimeout(state.autosaveTimer);

    var target = document.querySelector('[data-editor-target="' + scope + '"]');
    if (target) {
      target.textContent = '';
      target.dispatchEvent(new Event('input', { bubbles: true })); // re-triggers the is-empty placeholder check
    }

    renderSlots(scope);
    syncStickerActiveStates(scope);
    syncSlipActiveStates(scope);

    // reset visibility (or any other seg-group) back to whichever option
    // originally carried is-active in Designer, not just whatever's active now
    document.querySelectorAll('[data-seg-group]').forEach(function (group) {
      var defaultValue = group.getAttribute('data-original-default');
      if (!defaultValue) return;
      var defaultBtn = group.querySelector('.seg_btn[data-seg-value="' + defaultValue + '"]');
      if (!defaultBtn) return;
      group.querySelectorAll('.seg_btn').forEach(function (b) { b.classList.remove('is-active'); });
      defaultBtn.classList.add('is-active');
      group.setAttribute('data-selected', defaultValue);
    });

    var toggle = document.querySelector('[data-schedule-toggle="' + scope + '"]');
    var dtWrap = document.querySelector('[data-schedule-datetime="' + scope + '"]');
    if (toggle) toggle.classList.remove('is-active');
    if (dtWrap) dtWrap.style.display = 'none';
  }

  function closeComposer(scope) {
    var closeEl = document.getElementById('close-post');
    if (closeEl) {
      closeEl.click(); // fires the Memberstack-style hidden-tab close trick -- shared across all three composer tabs
    } else {
      console.warn('#close-post not found -- modal will not visually close.');
    }
    document.dispatchEvent(new CustomEvent('slipsocial:closeComposer', { detail: { scope: scope } }));
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    document.querySelectorAll('[data-editor-toolbar]').forEach(initToolbar);
    initSegmentedGroups();
    initMediaSlots();
    initMediaTypeSwitching();
    initMediaUpload();
    initStickerPicker();
    initKlipyPicker();
    initSlipPicker();
    initSchedule();
    initPublishCancelDraft();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * Slip Social — Core Shared Script
 * v1.0
 *
 * Load ONCE, site-wide, via Site Settings > Custom Code > Footer Code.
 * Exposes shared helpers on window.SlipSocial so page-specific scripts
 * (Step 4 follow cards, dashboard widgets, avatar sync, etc.) don't
 * duplicate Xano fetch logic, Memberstack lookups, or DOM boilerplate.
 *
 * Page-specific scripts live in each page's own Custom Code section
 * and should ALWAYS guard themselves before doing any work, e.g.:
 *
 *   SlipSocial.ready(function () {
 *     if (!document.querySelector('.first-follow-collection')) return;
 *     // ...page-specific logic here
 *   });
 */
(function () {
  'use strict';

  var XANO_BASE_URL = 'https://x8ki-letl-twmt.n7.xano.io/api:B6zsXs7-/';

  // ---------------------------------------------------------------
  // Memberstack
  // ---------------------------------------------------------------

  // Resolves with the logged-in member's Memberstack ID, or rejects
  // if Memberstack isn't loaded yet or no one is logged in.
  function getMemberstackId() {
    return new Promise(function (resolve, reject) {
      if (!window.$memberstackDom) {
        reject(new Error('[SlipSocial] Memberstack DOM package not found on window.'));
        return;
      }
      window.$memberstackDom.getCurrentMember()
        .then(function (result) {
          var member = result && result.data;
          if (!member || !member.id) {
            reject(new Error('[SlipSocial] No logged-in member found.'));
            return;
          }
          resolve(member.id);
        })
        .catch(reject);
    });
  }

  // ---------------------------------------------------------------
  // Memberstack session token (for server-side verification)
  // ---------------------------------------------------------------

  // Returns the current member's JWT, or null if not logged in / not
  // yet available. This is the SESSION token that Xano verifies
  // server-side against Memberstack's real API — never trust a
  // memberstack_id passed in a URL alone, always back it with this.
  function getMemberstackToken() {
    try {
      if (!window.$memberstackDom) return null;
      return window.$memberstackDom.getMemberCookie() || null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Xano fetch wrapper
  // ---------------------------------------------------------------

  // path         - e.g. 'members/mem_sb_xxx/suggested-follows' (leading slash optional)
  // options.method  - defaults to 'GET'
  // options.body    - plain object, will be JSON-stringified
  // options.headers - any extra headers to merge in
  // options.auth    - defaults to true; attaches the member's session
  //                    token as an Authorization header automatically.
  //                    Pass { auth: false } only for genuinely public
  //                    endpoints that need no member context.
  function fetchXano(path, options) {
    options = options || {};
    var url = XANO_BASE_URL + String(path).replace(/^\//, '');
    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      options.headers || {}
    );

    if (options.auth !== false) {
      var token = getMemberstackToken();
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }
    }

    var fetchOptions = { method: options.method || 'GET', headers: headers };
    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    return fetch(url, fetchOptions).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (errBody) {
          var message = (errBody && errBody.message) || ('Xano request failed: ' + response.status);
          throw new Error('[SlipSocial] ' + message);
        });
      }
      // Handle empty 200 responses gracefully
      return response.text().then(function (text) {
        return text ? JSON.parse(text) : null;
      });
    });
  }

  // ---------------------------------------------------------------
  // Template cloning
  // ---------------------------------------------------------------

  // Clones a hidden template element, fills it in from a data object
  // using a fieldMap, and returns the populated clone (not yet
  // inserted into the DOM — caller decides where it goes).
  //
  // templateEl   - the hidden template node to clone
  // data         - plain object with the values to insert
  // fieldMap     - { selector: fieldNameOrFn }
  //
  // Example:
  //   SlipSocial.cloneAndFill(template, member, {
  //     '.username-text': 'username',
  //     '.profile-avatar-img': 'profile_image_url', // auto-detects <img>, sets src
  //     '.hit-rate-text': function (el, data) {
  //       el.textContent = data.hit_rate === 'N/A' ? 'N/A hit rate' : data.hit_rate + '% hit rate';
  //     }
  //   });
  function cloneAndFill(templateEl, data, fieldMap) {
    var clone = templateEl.cloneNode(true);
    clone.removeAttribute('id'); // avoid duplicate IDs when cloning multiple times
    clone.style.display = '';   // unhide (assumes template is hidden via inline style or a class you remove below)
    clone.classList.remove('follow-card-template');

    Object.keys(fieldMap).forEach(function (selector) {
      var target = clone.querySelector(selector);
      if (!target) return;

      var mapping = fieldMap[selector];
      if (typeof mapping === 'function') {
        mapping(target, data);
      } else if (target.tagName === 'IMG') {
        target.src = data[mapping];
      } else {
        target.textContent = data[mapping];
      }
    });

    return clone;
  }

  // ---------------------------------------------------------------
  // DOM ready helper
  // ---------------------------------------------------------------

  function ready(fn) {
    if (document.readyState !== 'loading') {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  window.SlipSocial = {
    XANO_BASE_URL: XANO_BASE_URL,
    getMemberstackId: getMemberstackId,
    getMemberstackToken: getMemberstackToken,
    fetchXano: fetchXano,
    cloneAndFill: cloneAndFill,
    ready: ready
  };
})();

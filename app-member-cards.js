/**
 * Slip Social — Step 4 "Follow Your First Members" render script
 * Page-specific script for the Onboarding > Finish page ONLY.
 *
 * Paste this into that page's own Page Settings > Custom Code > Footer
 * Code — NOT the site-wide footer (that's reserved for slip-social-core.js).
 *
 * Depends on window.SlipSocial being already loaded (site-wide core script)
 * and on the hidden template card marked data-follow-card-template="true"
 * sitting inside its plain (non-CMS) parent container.
 */
(function () {
  'use strict';

  SlipSocial.ready(function () {
    var template = document.querySelector('[data-follow-card-template]');
    if (!template) return; // Not on this page — nothing to do.

    var list = template.parentElement;

    // Hide the template itself at runtime (rather than relying on Webflow's
    // own Hidden toggle, which appears to omit elements from published
    // output entirely instead of keeping them in the DOM as display:none).
    template.style.display = 'none';

    SlipSocial.getMemberstackId()
      .then(function (viewerId) {
        return SlipSocial.fetchXano('members/' + viewerId + '/suggested-follows').then(function (members) {
          (members || []).forEach(function (member) {
            list.appendChild(buildCard(template, member, viewerId));
          });
        });
      })
      .catch(function (err) {
        console.error('[SlipSocial] Failed to load suggested follows:', err);
      });

    function buildCard(template, member, viewerId) {
      var clone = template.cloneNode(true);
      clone.removeAttribute('data-follow-card-template');
      clone.style.display = '';

      // Avatar
      var avatar = clone.querySelector('.profile-avatar-img');
      if (avatar && member.profile_image_url) {
        avatar.src = member.profile_image_url;
      }

      // Username — two ".u-text-size-large" divs exist: the static "@" symbol
      // (index 0, leave alone) and the empty username slot (index 1).
      var usernameEls = clone.querySelectorAll('.u-text-size-large');
      if (usernameEls[1]) {
        usernameEls[1].textContent = member.username;
      }

      // Hit rate — two ".u-text-size-xxsmall" paragraphs: the number/N-A
      // (index 0) and the "% hit rate" / "hit rate" suffix (index 1).
      var hitRateEls = clone.querySelectorAll('.u-text-size-xxsmall');
      if (hitRateEls[0] && hitRateEls[1]) {
        if (member.hit_rate === 'N/A') {
          hitRateEls[0].textContent = 'N/A';
          hitRateEls[1].textContent = 'hit rate';
        } else {
          hitRateEls[0].textContent = member.hit_rate;
          hitRateEls[1].textContent = '% hit rate';
        }
      }

      // Mode badge — show only the one matching member_mode. Both badges
      // share ".u-label-badge" with the Follow button, so exclude ".green"
      // (the Follow button's combo class) to isolate just the two mode badges.
      var modeBadges = Array.prototype.filter.call(
        clone.querySelectorAll('.u-label-badge'),
        function (el) { return !el.classList.contains('green'); }
      );
      modeBadges.forEach(function (badge) {
        var label = badge.textContent.trim().toLowerCase();
        badge.style.display = (label === String(member.member_mode).toLowerCase()) ? '' : 'none';
      });

      // Sports tags
      var sportsContainer = clone.querySelector('.mos.list');
      if (sportsContainer && Array.isArray(member.sports)) {
        member.sports.forEach(function (sport) {
          var tag = document.createElement('p');
          tag.className = 'u-text-size-xxsmall';
          tag.textContent = (sport.emoji ? sport.emoji + ' ' : '') + sport.name;
          sportsContainer.appendChild(tag);
        });
      }

      // Follow button
      var followBtn = clone.querySelector('.u-label-badge.green');
      if (followBtn) {
        followBtn.addEventListener('click', function (e) {
          e.preventDefault();
          if (followBtn.dataset.following === 'true') return; // guard double-click

          followBtn.dataset.following = 'true';
          SlipSocial.fetchXano('members/' + viewerId + '/follow', {
            method: 'POST',
            body: { followed_id: member.id }
          })
            .then(function () {
              followBtn.textContent = 'Following';
              followBtn.style.pointerEvents = 'none';
              followBtn.style.opacity = '0.5';
            })
            .catch(function (err) {
              console.error('[SlipSocial] Follow failed:', err);
              followBtn.dataset.following = 'false'; // allow retry
            });
        });
      }

      return clone;
    }
  });
})();

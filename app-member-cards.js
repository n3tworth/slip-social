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

      // Avatar — falls back to a generated initials avatar (matching the
      // pattern already used site-wide for the member's own profile) when
      // no profile_image_url exists. Background color matches the mode
      // badge color for visual consistency.
      var avatar = clone.querySelector('.profile-avatar-img');
      if (avatar) {
        if (member.profile_image_url) {
          avatar.src = member.profile_image_url;
        } else {
          var bgColor = String(member.member_mode).toLowerCase() === 'hybrid' ? '#00A5DE' : '#3E5AFD';
          avatar.src = buildInitialsAvatar(member.username, bgColor);
        }
      }

      // Username — targets the dedicated combo class added specifically
      // for this card (safe to resize independently of the shared
      // u-text-size-large utility class used elsewhere on the site).
      var usernameEl = clone.querySelector('.follow-username-text');
      if (usernameEl) {
        usernameEl.textContent = member.username;
      }

      // Hit rate — two ".u-text-size-xxsmall" paragraphs: the number/N-A
      // (index 0) and the "% hit rate" / " hit rate" suffix (index 1).
      // Rounds to 1 decimal defensively — the real fix belongs in the
      // Xano endpoint itself, this just guards the display either way.
      var hitRateEls = clone.querySelectorAll('.u-text-size-xxsmall');
      if (hitRateEls[0] && hitRateEls[1]) {
        if (member.hit_rate === 'N/A') {
          hitRateEls[0].textContent = 'N/A';
          hitRateEls[1].textContent = ' hit rate';
        } else {
          var rounded = Math.round(parseFloat(member.hit_rate) * 10) / 10;
          hitRateEls[0].textContent = rounded;
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

      // Follow button — toggles between follow (POST) and unfollow (DELETE)
      // on the same endpoint path, matching standard REST convention.
      // "Following" state drops the green class (reverting to the plain
      // white badge look) rather than dimming, and stays clickable so the
      // member can unfollow by clicking again.
      var followBtn = clone.querySelector('.u-label-badge.green');
      if (followBtn) {
        followBtn.dataset.following = 'false';

        followBtn.addEventListener('click', function (e) {
          e.preventDefault();
          if (followBtn.dataset.busy === 'true') return; // guard in-flight request
          followBtn.dataset.busy = 'true';

          var isFollowing = followBtn.dataset.following === 'true';
          var method = isFollowing ? 'DELETE' : 'POST';

          SlipSocial.fetchXano('members/' + viewerId + '/follow', {
            method: method,
            body: { followed_id: member.id }
          })
            .then(function () {
              if (isFollowing) {
                followBtn.textContent = 'Follow';
                followBtn.classList.add('green');
                followBtn.dataset.following = 'false';
              } else {
                followBtn.textContent = 'Following';
                followBtn.classList.remove('green');
                followBtn.dataset.following = 'true';
              }
            })
            .catch(function (err) {
              console.error('[SlipSocial] Follow/unfollow toggle failed:', err);
            })
            .finally(function () {
              followBtn.dataset.busy = 'false';
            });
        });
      }

      return clone;
    }

    // Generates a small SVG initials avatar as a data URI, matching the
    // pattern already used site-wide for a member's own profile image
    // fallback (see MemberScript #143 in the site-wide footer).
    function buildInitialsAvatar(username, bgColor) {
      var initials = (username || '?').slice(0, 2).toUpperCase();
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">' +
        '<rect width="100" height="100" fill="' + bgColor + '"/>' +
        '<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" ' +
        'font-family="Arial, sans-serif" font-size="38" font-weight="bold" fill="#FFFFFF">' +
        initials + '</text></svg>';
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
  });
})();

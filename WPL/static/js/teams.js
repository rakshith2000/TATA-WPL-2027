/* ==========================================================================
   WPL 2027 · Teams
   Search, sort, flip-to-honours and deep links.

   The page is fully usable with no JS: every card is rendered in the default
   order, both faces are real markup and the roll of honour links are plain
   in-page anchors. Everything below is an upgrade on top of that.
   ========================================================================== */

(function () {
  'use strict';

  var grid = document.getElementById('tmGrid');
  if (!grid) return;

  var bar = document.getElementById('tmBar');
  var search = document.getElementById('tmSearch');
  var clearBtn = document.getElementById('tmClear');
  var shown = document.getElementById('tmShown');
  var empty = document.getElementById('tmEmpty');
  var emptyText = document.getElementById('tmEmptyText');
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.tm-card'));
  var SORT_KEY = 'tm-sort';

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------- sticky bar */

  function navHeight() {
    var nav = document.querySelector('nav.navbar');
    return nav ? nav.getBoundingClientRect().height : 66;
  }

  /* The navbar is fixed, so the toolbar has to stick just below it. Its height
     varies with the viewport, hence the measurement instead of a constant. */
  function syncStick() {
    document.documentElement.style.setProperty('--tm-stick', (navHeight() + 8) + 'px');
  }

  syncStick();
  window.addEventListener('resize', syncStick);

  function topOffset() {
    return navHeight() + (bar ? bar.getBoundingClientRect().height : 0) + 18;
  }

  function goTo(el, smooth) {
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.pageYOffset - topOffset();
    window.scrollTo({ top: y < 0 ? 0 : y, behavior: smooth && !still ? 'smooth' : 'auto' });
  }

  /* --------------------------------------------------------------- search */

  function norm(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function applySearch(raw) {
    var q = norm(raw);
    var count = 0;

    cards.forEach(function (card) {
      var hit = !q || card.getAttribute('data-search').indexOf(q) !== -1;
      card.hidden = !hit;
      if (hit) count++;
      /* a hidden card must not keep a flipped face waiting behind it */
      if (!hit && card.classList.contains('is-flipped')) flip(card, false, false);
    });

    if (shown) shown.textContent = count;
    if (clearBtn) clearBtn.hidden = !q;
    if (empty) {
      empty.classList.toggle('is-on', count === 0);
      if (count === 0 && emptyText) {
        emptyText.textContent = 'Nothing matches “' + raw.trim() + '”. ' +
          'Try a team name, a captain, a coach or a home ground.';
      }
    }
  }

  if (search) {
    var typing = null;
    search.addEventListener('input', function () {
      clearTimeout(typing);
      typing = setTimeout(function () { applySearch(search.value); }, 120);
    });

    /* Enter on a single result opens it — the quickest path to a squad */
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && search.value) {
        search.value = '';
        applySearch('');
        e.preventDefault();
        return;
      }
      if (e.key !== 'Enter') return;
      var left = cards.filter(function (c) { return !c.hidden; });
      if (left.length === 1) {
        var link = left[0].querySelector('[data-squad]');
        if (link) window.location.href = link.getAttribute('href');
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (search) {
        search.value = '';
        search.focus();
      }
      applySearch('');
    });
  }

  /* ----------------------------------------------------------------- sort */

  var SORTS = {
    /* league position; teams with no standings row fall to the back */
    pos: function (a, b) {
      return num(a, 'data-pos') - num(b, 'data-pos') || byName(a, b);
    },
    /* most successful first, then whoever won one most recently */
    titles: function (a, b) {
      return num(b, 'data-titles') - num(a, 'data-titles') ||
             num(b, 'data-latest') - num(a, 'data-latest') ||
             byName(a, b);
    },
    name: byName
  };

  function num(el, attr) {
    var v = parseFloat(el.getAttribute(attr));
    return isNaN(v) ? 999 : v;
  }

  function byName(a, b) {
    return a.getAttribute('data-name') < b.getAttribute('data-name') ? -1 : 1;
  }

  function applySort(key, remember) {
    var cmp = SORTS[key];
    if (!cmp) return;

    cards.slice().sort(cmp).forEach(function (card) { grid.appendChild(card); });

    Array.prototype.forEach.call(document.querySelectorAll('.tm-seg__btn'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-sort') === key));
    });

    if (remember) {
      try { sessionStorage.setItem(SORT_KEY, key); } catch (e) { /* private mode */ }
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tm-seg__btn'), function (btn) {
    if (btn.disabled) return;
    btn.addEventListener('click', function () {
      applySort(btn.getAttribute('data-sort'), true);
    });
  });

  /* Restore the last choice, unless it was the standings order on a page that
     no longer offers it (the season has been reset and nobody has played). */
  (function () {
    var saved = null;
    try { saved = sessionStorage.getItem(SORT_KEY); } catch (e) { /* ignore */ }
    if (!saved || !SORTS[saved]) return;
    var btn = document.querySelector('.tm-seg__btn[data-sort="' + saved + '"]');
    if (btn && !btn.disabled) applySort(saved, false);
  })();

  /* ------------------------------------------------------ flip to honours */

  /* Hover-to-flip is a dead end on touch, so the flip is an explicit control.
     Both faces stay in the DOM for the 3D transform, which means the hidden
     one has to be taken out of the tab order by hand. */
  function faceState(card) {
    var on = card.classList.contains('is-flipped');
    [['.tm-face--front', !on], ['.tm-face--back', on]].forEach(function (pair) {
      var face = card.querySelector(pair[0]);
      if (!face) return;
      face.setAttribute('aria-hidden', pair[1] ? 'true' : 'false');
      Array.prototype.forEach.call(face.querySelectorAll('a, button'), function (el) {
        if (pair[1]) el.removeAttribute('tabindex');
        else el.setAttribute('tabindex', '-1');
      });
    });

    var toggle = card.querySelector('[data-flip="open"]');
    if (toggle) toggle.setAttribute('aria-expanded', String(on));
  }

  function flip(card, to, moveFocus) {
    var on = typeof to === 'boolean' ? to : !card.classList.contains('is-flipped');
    card.classList.toggle('is-flipped', on);
    faceState(card);
    if (!moveFocus) return;
    var target = card.querySelector(on ? '[data-flip="close"]' : '[data-flip="open"]');
    if (target) target.focus();
  }

  cards.forEach(function (card) {
    faceState(card);
    Array.prototype.forEach.call(card.querySelectorAll('[data-flip]'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        flip(card, btn.getAttribute('data-flip') === 'open', true);
      });
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = cards.filter(function (c) { return c.classList.contains('is-flipped'); });
    if (!open.length) return;
    /* close the one being read: whichever holds focus, else all of them */
    var here = open.filter(function (c) { return c.contains(document.activeElement); });
    (here.length ? here : open).forEach(function (c) { flip(c, false, here.length > 0); });
  });

  /* --------------------------------------------------------- deep links */

  var spotlight = null;

  function reveal(abv, honours, smooth) {
    if (!abv || !/^[A-Za-z]+$/.test(abv)) return false;
    var card = grid.querySelector('.tm-card[data-abv="' + abv.toUpperCase() + '"]');
    if (!card) return false;

    /* a search in progress must not hide the card we were asked to show */
    if (card.hidden && search) {
      search.value = '';
      applySearch('');
    }

    goTo(card, smooth);
    if (honours) flip(card, true, false);

    clearTimeout(spotlight);
    cards.forEach(function (c) { c.classList.remove('is-target'); });
    card.classList.add('is-target');
    spotlight = setTimeout(function () { card.classList.remove('is-target'); }, 2600);
    return true;
  }

  /* Roll of honour: jump to the winner's card and open its honours face.
     The href is a real anchor, so this only improves on the default. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-jump]'), function (link) {
    link.addEventListener('click', function (e) {
      if (reveal(link.getAttribute('data-jump'), true, true)) e.preventDefault();
    });
  });

  /* /teams#CSK from anywhere else on the site */
  function fromHash(smooth) {
    var hash = (location.hash || '').replace(/^#(tm-)?/, '');
    if (hash) reveal(hash, false, smooth);
  }

  window.addEventListener('hashchange', function () { fromHash(true); });
  /* after load: crests and the squad cut-outs settle the card heights first */
  window.addEventListener('load', function () { fromHash(false); });

  /* -------------------------------------------------------- back to top */

  var barTop = bar ? bar.offsetTop : 0;

  var toTop = document.createElement('button');
  toTop.type = 'button';
  toTop.className = 'floating-move-top-btn';
  toTop.title = 'Back to top';
  toTop.setAttribute('aria-label', 'Back to top');
  toTop.innerHTML = '<span class="material-icons-round">arrow_upward</span>';
  document.body.appendChild(toTop);

  toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
  });

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      if (bar) bar.classList.toggle('is-stuck', window.pageYOffset > barTop - 80);
      toTop.classList.toggle('is-on', window.pageYOffset > 520);
      ticking = false;
    });
  }, { passive: true });
})();

/* ==========================================================================
   WPL 2027 · Home page
   Season Toppers carousel + back-to-top.

   The markup ships as a scroll-snapping strip, so it already works with no
   JS at all. Everything below is an upgrade on top of that: once `is-js` is
   set the stage stops scrolling and a transform drives the track instead,
   which is what lets the slides bounce and the neighbours sit back.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------ match spotlight */

  var featured = document.querySelector('.hm-featured[data-live-url]');

  if (featured) {
    var matchState = featured.getAttribute('data-state');
    var liveUrl = featured.getAttribute('data-live-url');
    var status = featured.querySelector('[data-live-status]');
    var scoreA = featured.querySelector('[data-live-score-a]');
    var scoreB = featured.querySelector('[data-live-score-b]');
    var stateLabel = featured.querySelector('[data-feature-state-label]');
    var countdown = featured.querySelector('[data-countdown]');
    var countdownValue = featured.querySelector('[data-countdown-value]');
    var polling = false;
    var inFlight = false;
    var countdownTimer = null;

    function showLive() {
      if (matchState === 'live') return;
      matchState = 'live';
      featured.setAttribute('data-state', 'live');
      if (stateLabel) stateLabel.textContent = 'Live match';
      if (countdown) countdown.hidden = true;
      if (status) {
        status.hidden = false;
        status.textContent = 'Checking live score…';
      }
      var eyebrow = featured.querySelector('.hm-featured__eyebrow');
      if (eyebrow && !eyebrow.querySelector('i')) {
        var dot = document.createElement('i');
        dot.setAttribute('aria-hidden', 'true');
        eyebrow.insertBefore(dot, stateLabel);
      }
      startPolling();
    }

    function renderLive(data) {
      if (!data || !data.ok) {
        if (status) status.textContent = 'Live feed temporarily unavailable. Match Centre still has match details.';
        return;
      }
      var teams = data.teams || [];
      var teamA = featured.getAttribute('data-team-a');
      var teamB = featured.getAttribute('data-team-b');
      var sideA = teams.find(function (team) { return team.team === teamA; });
      var sideB = teams.find(function (team) { return team.team === teamB; });
      if (sideA && scoreA) scoreA.textContent = sideA.score || '—';
      if (sideB && scoreB) scoreB.textContent = sideB.score || '—';
      var message = data.info || data.status || '';
      if (!message && !sideA && !sideB) message = 'Waiting for the live score feed.';
      if (status) status.textContent = message || 'Live score updated.';
    }

    function pollLive() {
      if (inFlight) return;
      inFlight = true;
      fetch(liveUrl, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('Live score request failed (' + response.status + ')');
          return response.json();
        })
        .then(renderLive)
        .catch(function (error) {
          if (status) status.textContent = 'Live feed temporarily unavailable. Match Centre still has match details.';
          console.warn('Homepage live score refresh failed:', error);
        })
        .then(function () { inFlight = false; });
    }

    function startPolling() {
      if (polling) return;
      polling = true;
      pollLive();
      window.setInterval(pollLive, 15000);
    }

    if (matchState === 'live') {
      startPolling();
    } else if (matchState === 'upcoming' && countdownValue) {
      var kickoff = Date.parse(featured.getAttribute('data-start'));
      function updateCountdown() {
        var remaining = Math.max(0, Math.floor((kickoff - Date.now()) / 1000));
        if (remaining === 0) {
          if (countdownTimer) window.clearInterval(countdownTimer);
          countdownValue.textContent = 'Starting now';
          showLive();
          return;
        }
        var days = Math.floor(remaining / 86400);
        var hours = Math.floor((remaining % 86400) / 3600);
        var minutes = Math.floor((remaining % 3600) / 60);
        countdownValue.textContent = (days ? days + 'd ' : '') +
          String(hours).padStart(2, '0') + 'h ' +
          String(minutes).padStart(2, '0') + 'm';
      }
      if (Number.isNaN(kickoff)) {
        countdownValue.textContent = 'Scheduled';
      } else {
        updateCountdown();
        countdownTimer = window.setInterval(updateCountdown, 1000);
      }
    }
  }

  /* --------------------------------------------------------- carousel */

  var root = document.getElementById('tpCarousel');

  if (root) {
    var stage = root.querySelector('.hm-tp__stage');
    var track = root.querySelector('.hm-tp__track');
    var slides = Array.prototype.slice.call(root.querySelectorAll('.hm-tp__slide'));
    var tabs = Array.prototype.slice.call(root.querySelectorAll('.hm-tab'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('.hm-dot'));
    var prev = root.querySelector('.hm-tp__arrow--prev');
    var next = root.querySelector('.hm-tp__arrow--next');
    var playBtn = root.querySelector('.hm-tp__play');
    var nowEl = root.querySelector('[data-tp-now]');

    var AUTO_MS = 6000;
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var at = 0;
    var timer = null;
    var playing = false;

    if (slides.length) {
      root.classList.add('is-js');
      stage.scrollLeft = 0;          /* hand over from the no-JS scroller */

      /* --------------------------------------------------------- paint */

      /* The track is centred on the active slide, so the neighbours peek in
         from both sides at any viewport width — then clamped to the stage, so
         the first and last cards sit flush instead of against dead space.

         The far edge comes from the last slide's layout box, NOT the track's
         scrollWidth: scrollable overflow is measured from the *transformed*
         boxes, and the resting slides are scale(0.9). That makes scrollWidth
         under-report the track by half a slide's shrinkage, so the clamp stops
         short and the last card is left hanging over the edge. offsetLeft and
         offsetWidth ignore transforms, so they stay honest. */
      function offsetFor(i) {
        var slide = slides[i];
        if (!slide) return 0;
        var last = slides[slides.length - 1];
        var contentEnd = last.offsetLeft + last.offsetWidth;
        var want = (stage.clientWidth / 2) - (slide.offsetLeft + slide.offsetWidth / 2);
        var min = stage.clientWidth - contentEnd;
        if (min >= 0) return want;                 /* whole track fits: centre it */
        return Math.min(0, Math.max(min, want));
      }

      /* Bring the selected tab into view by scrolling the strip and nothing
         else. scrollIntoView() would do the same job, but it walks up and
         scrolls every scrollable ancestor including the document — so an
         autoplay tick would yank the reader back up to the carousel from
         wherever they had scrolled to. */
      function centreTab(tab) {
        if (!tab) return;
        var strip = tab.parentNode;
        if (strip.scrollWidth <= strip.clientWidth) return;
        var sr = strip.getBoundingClientRect();
        var tr = tab.getBoundingClientRect();
        var delta = (tr.left + tr.width / 2) - (sr.left + sr.width / 2);
        if (Math.abs(delta) < 1) return;
        if (strip.scrollBy) strip.scrollBy({ left: delta, behavior: still ? 'auto' : 'smooth' });
        else strip.scrollLeft += delta;
      }

      function paint(animate) {
        if (!animate) track.style.transition = 'none';
        track.style.transform = 'translate3d(' + offsetFor(at) + 'px, 0, 0)';
        if (!animate) {
          void track.offsetWidth;              /* flush, then restore easing */
          track.style.transition = '';
        }

        slides.forEach(function (s, i) {
          var on = i === at;
          s.classList.toggle('is-active', on);
          s.setAttribute('aria-hidden', on ? 'false' : 'true');
          /* keep hidden cards out of the tab order */
          Array.prototype.forEach.call(s.querySelectorAll('a, button'), function (el) {
            if (on) el.removeAttribute('tabindex');
            else el.setAttribute('tabindex', '-1');
          });
        });

        tabs.forEach(function (t, i) {
          t.setAttribute('aria-selected', String(i === at));
        });
        dots.forEach(function (d, i) {
          d.setAttribute('aria-selected', String(i === at));
        });

        if (prev) prev.disabled = at === 0;
        if (next) next.disabled = at === slides.length - 1;
        if (nowEl) nowEl.textContent = at + 1;

        /* the accent recolours the tabs, dots and arrows with the card */
        var acc = slides[at].getAttribute('data-acc');
        if (acc) root.style.setProperty('--acc', acc);

        centreTab(tabs[at]);
      }

      function goTo(i, fromUser) {
        at = Math.max(0, Math.min(slides.length - 1, i));
        paint(true);
        if (fromUser) restart();
      }

      /* ----------------------------------------------------- autoplay */

      /* Two inputs decide whether the timer runs. `engaged` is hover or focus,
         which pauses only for as long as it lasts; `override` is the play/pause
         button, and once pressed it wins outright — otherwise the button would
         appear to do nothing while the pointer still sits on the carousel. */
      var engaged = false;
      var override = null;

      function shouldRun() {
        if (still || slides.length < 2) return false;
        return override === null ? !engaged : override;
      }

      function sync() {
        var run = shouldRun();
        if (run && !timer) {
          timer = setInterval(function () {
            if (document.hidden) return;      /* don't burn cycles in a background tab */
            at = (at + 1) % slides.length;
            paint(true);
          }, AUTO_MS);
        } else if (!run && timer) {
          clearInterval(timer);
          timer = null;
        }
        playing = !!timer;
        syncPlayBtn();
      }

      /* A nudge from the user should not fight the timer — reset its phase. */
      function restart() {
        if (timer) { clearInterval(timer); timer = null; }
        sync();
      }

      function engage(on) {
        engaged = on;
        sync();
      }

      function syncPlayBtn() {
        if (!playBtn) return;
        var icon = playBtn.querySelector('[class*="material-icons"]');
        if (icon) icon.textContent = playing ? 'pause' : 'play_arrow';
        playBtn.setAttribute('aria-label', playing ? 'Pause auto-rotation' : 'Start auto-rotation');
        playBtn.setAttribute('aria-pressed', String(playing));
      }

      /* ------------------------------------------------------ controls */

      if (prev) prev.addEventListener('click', function () { goTo(at - 1, true); });
      if (next) next.addEventListener('click', function () { goTo(at + 1, true); });

      tabs.concat(dots).forEach(function (btn) {
        btn.addEventListener('click', function () {
          goTo(parseInt(btn.getAttribute('data-go'), 10) || 0, true);
        });
      });

      if (playBtn) {
        playBtn.addEventListener('click', function () {
          override = !playing;
          sync();
        });
      }

      /* clicking a dimmed neighbour brings it forward */
      slides.forEach(function (s, i) {
        s.addEventListener('click', function (e) {
          if (i === at) return;
          e.preventDefault();
          goTo(i, true);
        });
      });

      root.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { goTo(at + 1, true); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { goTo(at - 1, true); e.preventDefault(); }
        else if (e.key === 'Home') { goTo(0, true); e.preventDefault(); }
        else if (e.key === 'End') { goTo(slides.length - 1, true); e.preventDefault(); }
      });

      /* Pause while the user is reading or tabbing through a card, and pick up
         again the moment they move on. */
      root.addEventListener('mouseenter', function () { engage(true); });
      root.addEventListener('mouseleave', function () { engage(false); });
      root.addEventListener('focusin', function () { engage(true); });
      root.addEventListener('focusout', function (e) {
        if (!root.contains(e.relatedTarget)) engage(false);
      });

      /* ---------------------------------------------------- swipe/drag */

      var down = null;
      var swiped = false;

      function dragStart(x) {
        down = { x: x, base: offsetFor(at), moved: 0 };
        swiped = false;
        root.classList.add('is-dragging');
        /* hold the timer for the duration of the gesture, whatever the state */
        if (timer) { clearInterval(timer); timer = null; playing = false; syncPlayBtn(); }
      }

      function dragMove(x) {
        if (!down) return false;
        down.moved = x - down.x;
        if (Math.abs(down.moved) < 4) return false;
        track.style.transform = 'translate3d(' + (down.base + down.moved) + 'px, 0, 0)';
        return true;
      }

      function dragEnd() {
        if (!down) return;
        var moved = down.moved;
        down = null;
        /* Remembered for the click that a real drag is about to produce, so a
           swipe never opens the card's leaderboard link. */
        swiped = Math.abs(moved) > 6;
        root.classList.remove('is-dragging');
        var step = slides[0].offsetWidth * 0.22;       /* a fifth of a card commits */
        if (moved <= -step) at = Math.min(slides.length - 1, at + 1);
        else if (moved >= step) at = Math.max(0, at - 1);
        paint(true);
        /* A touch swipe leaves `engaged` false, so this resumes; a mouse drag
           keeps it true from mouseenter, so it stays held. Both are right. */
        sync();
      }

      stage.addEventListener('touchstart', function (e) {
        dragStart(e.touches[0].clientX);
      }, { passive: true });

      stage.addEventListener('touchmove', function (e) {
        if (dragMove(e.touches[0].clientX)) e.preventDefault();
      }, { passive: false });

      stage.addEventListener('touchend', dragEnd);
      stage.addEventListener('touchcancel', dragEnd);

      stage.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        dragStart(e.clientX);
      });

      window.addEventListener('mousemove', function (e) { dragMove(e.clientX); });
      window.addEventListener('mouseup', dragEnd);

      /* Swallow the click a drag leaves behind — captured, so it never reaches
         the leaderboard link or the bring-this-card-forward handler below. */
      stage.addEventListener('click', function (e) {
        if (!swiped) return;
        swiped = false;
        e.preventDefault();
        e.stopPropagation();
      }, true);

      /* ---------------------------------------------------- lifecycle */

      var resizeTimer = null;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { paint(false); }, 120);
      });

      /* fonts and crests change the card width after first paint */
      window.addEventListener('load', function () { paint(false); });

      /* a control that cannot do anything is worse than no control */
      if (still && playBtn) playBtn.hidden = true;

      paint(false);
      sync();
    }
  }

  /* ------------------------------------------------------ back to top */

  var toTop = document.createElement('button');
  toTop.type = 'button';
  toTop.className = 'floating-move-top-btn';
  toTop.title = 'Back to top';
  toTop.setAttribute('aria-label', 'Back to top');
  toTop.innerHTML = '<span class="material-icons-round">arrow_upward</span>';
  document.body.appendChild(toTop);

  toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      toTop.classList.toggle('is-on', window.pageYOffset > 520);
      ticking = false;
    });
  }, { passive: true });
})();

/* ==========================================================================
   WPL 2027 · Team squad
   The page is static by design — no filters, nothing to re-order. This adds
   the back-to-top control the other pages have, and lets the player cards
   arrive as you reach them.
   ========================================================================== */

(function () {
  'use strict';

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------ back to top */

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
      toTop.classList.toggle('is-on', window.pageYOffset > 520);
      ticking = false;
    });
  }, { passive: true });

  /* --------------------------------------------------- card reveal */

  /* Cards start visible in CSS, so a browser without IntersectionObserver —
     or with reduced motion asked for — simply shows the squad as it is. */
  if (still || !('IntersectionObserver' in window)) return;

  var cards = Array.prototype.slice.call(document.querySelectorAll('.pl-card'));
  if (!cards.length) return;

  cards.forEach(function (card) { card.classList.add('is-waiting'); });

  var seen = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var card = entry.target;
      /* stagger across the row the card sits in, not the whole page, so a
         long squad never ends up with a two-second tail */
      var row = Array.prototype.indexOf.call(card.parentNode.children, card) % 6;
      card.style.transitionDelay = (row * 45) + 'ms';
      card.classList.remove('is-waiting');
      seen.unobserve(card);
    });
  }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });

  cards.forEach(function (card) { seen.observe(card); });
})();

      // Navbar chrome: elevation on scroll + current-page highlight

      (function() {
        const nav = document.querySelector('nav.navbar');
        if (!nav) return;

        // Denser shadow once the page leaves the top
        let ticking = false;
        function syncScrolled() {
          nav.classList.toggle('is-scrolled', window.pageYOffset > 8);
          ticking = false;
        }
        window.addEventListener('scroll', () => {
          if (ticking) return;
          ticking = true;
          window.requestAnimationFrame(syncScrolled);
        }, {passive: true});
        syncScrolled();

        // Mark the link matching the current page. Detail pages live under
        // their own routes, so a few sections need extra prefixes. Keys are the
        // link's own target, including ?filter= where two links share a path.
        const ALIASES = {
          '/fixtures': ['/match-'],
          '/fixtures?filter=live': ['/todayMatch'],
          '/battingstats': ['/bowlingstats', '/awards']
        };

        const tidy = p => p.replace(/\/+$/, '') || '/';

        function syncActive() {
          const here = tidy(window.location.pathname);
          let hereFilter = null;
          try {
            hereFilter = new URLSearchParams(window.location.search).get('filter');
          } catch (e) { /* ignore */ }

          const links = [];
          nav.querySelectorAll('.navbar-nav .nav-link[href]').forEach(link => {
            let url;
            try {
              url = new URL(link.getAttribute('href'), window.location.origin);
            } catch (e) {
              return;
            }
            const path = tidy(url.pathname);
            if (path === '/') return;
            const filter = url.searchParams.get('filter');
            const sig = path + (filter ? '?filter=' + filter : '');
            const hit = here.indexOf(path) === 0 ||
                        (ALIASES[sig] || []).some(p => here.indexOf(p) === 0);
            links.push({ link, path, filter, hit });
          });

          // MATCHES and LIVE both sit on /fixtures, so a shared path is settled
          // by ?filter=: an exact match wins, otherwise the plain link does.
          const winners = new Set();
          links.filter(l => l.hit).forEach(l => {
            const group = links.filter(o => o.hit && o.path === l.path);
            if (group.length < 2) { winners.add(l.link); return; }
            const exact = group.find(o => o.filter === hereFilter);
            winners.add((exact || group.find(o => !o.filter) || group[0]).link);
          });

          links.forEach(({ link }) => {
            const on = winners.has(link);
            link.classList.toggle('active', on);
            if (on) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
          });
        }

        syncActive();

        // Pages that change ?filter= in place (the fixtures list) call this to
        // keep the navbar honest without a reload.
        window.syncNavActive = syncActive;
      })();

      // Custom dropdown behavior: hover on desktop, click on mobile for .custom-dropdown

      (function() {
        const BREAKPOINT = 992; // matches Bootstrap lg
        function isDesktop() { return window.innerWidth >= BREAKPOINT; }

        function bindHover() {
          document.querySelectorAll('nav.navbar .custom-dropdown').forEach(drop => {
            if (drop.__hoverBound) return;
            drop.__hoverBound = true;
            const toggle = drop.querySelector('.custom-dropdown-toggle');
            const menu = drop.querySelector('.custom-dropdown-menu');
            drop.addEventListener('mouseenter', () => {
              if (!isDesktop()) return;
              drop.classList.add('is-open');
              if (menu) menu.classList.add('show');
              if (toggle) toggle.setAttribute('aria-expanded', 'true');
            });
            drop.addEventListener('mouseleave', () => {
              if (!isDesktop()) return;
              drop.classList.remove('is-open');
              if (menu) menu.classList.remove('show');
              if (toggle) toggle.setAttribute('aria-expanded', 'false');
            });
          });
        }

        function bindDelegatedClick() {
          if (window.__customDropdownClickBound) return;
          window.__customDropdownClickBound = true;
          let lastTouchTime = 0;

          function handleToggleForEvent(toggle) {
            if (isDesktop()) return; // desktop uses hover
            const drop = toggle.closest('.custom-dropdown');
            if (!drop) return;
            const menu = drop.querySelector('.custom-dropdown-menu');
            const willOpen = !drop.classList.contains('is-open');
            drop.classList.toggle('is-open', willOpen);
            if (menu) menu.classList.toggle('show', willOpen);
            toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          }

          // touchstart to make taps immediate
          document.addEventListener('touchstart', function(e) {
            lastTouchTime = Date.now();
            const toggle = e.target.closest('.custom-dropdown-toggle');
            if (toggle && toggle.closest('nav.navbar')) {
              e.preventDefault();
              handleToggleForEvent(toggle);
              e.stopPropagation();
              e.stopImmediatePropagation();
            }
          }, {passive: false});

          // click as fallback (ignore if recent touch)
          document.addEventListener('click', (e) => {
            if (Date.now() - lastTouchTime < 700) return;
            const toggle = e.target.closest('.custom-dropdown-toggle');
            if (toggle && toggle.closest('nav.navbar')) {
              if (isDesktop()) { e.preventDefault(); return; }
              e.preventDefault();
              handleToggleForEvent(toggle);
              e.stopPropagation();
              e.stopImmediatePropagation();
              return;
            }
            // Click outside: close open dropdowns on mobile
            if (!e.target.closest('nav.navbar')) {
              if (!isDesktop()) {
                document.querySelectorAll('nav.navbar .custom-dropdown.is-open').forEach(d => {
                  d.classList.remove('is-open');
                  const m = d.querySelector('.custom-dropdown-menu');
                  if (m) m.classList.remove('show');
                  const t = d.querySelector('.custom-dropdown-toggle');
                  if (t) t.setAttribute('aria-expanded','false');
                });
              }
            }
          });
        }

        bindHover();
        bindDelegatedClick();

        // Close open dropdowns on resize and re-bind hover handlers (debounced)
        let resTimer = null;
        window.addEventListener('resize', () => {
          clearTimeout(resTimer);
          resTimer = setTimeout(() => {
            document.querySelectorAll('nav.navbar .custom-dropdown.is-open').forEach(d => {
              d.classList.remove('is-open');
              const m = d.querySelector('.custom-dropdown-menu');
              if (m) m.classList.remove('show');
              const t = d.querySelector('.custom-dropdown-toggle');
              if (t) t.setAttribute('aria-expanded','false');
            });
            // Re-bind hover handlers in case DOM changed
            bindHover();
          }, 120);
        });

      })();
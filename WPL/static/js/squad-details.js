/* ==========================================================================
   WPL 2027 · Player profile — season-by-season stats
   Builds one pane per discipline from `statsData` (set by squad_details.html,
   shaped by get_player_stats in main.py): a season trend chart, then the same
   numbers as a table on desktop and as a key/value card on phones.

   The season chips in the filter row scope everything below them — both
   disciplines re-render against the same choice.
   ========================================================================== */

(function () {
  'use strict';

  /* Column order for each discipline. `k` is the feed's key, `l` the header,
     `t` the long form for the header tooltip, and `kv` marks the handful that
     are worth a cell on the phone card. */
  var BATTING = [
    { k: 'Matches',      l: 'Mat',  t: 'Matches',        kv: 1 },
    { k: 'Innings',      l: 'Inns', t: 'Innings' },
    { k: 'NotOuts',      l: 'NO',   t: 'Not outs' },
    { k: 'Runs',         l: 'Runs', t: 'Runs scored',    kv: 1 },
    { k: 'HighestScore', l: 'HS',   t: 'Highest score',  kv: 1 },
    { k: 'BattingAvg',   l: 'Avg',  t: 'Batting average', kv: 1 },
    { k: 'StrikeRate',   l: 'SR',   t: 'Strike rate',    kv: 1 },
    { k: 'Hundreds',     l: '100s', t: 'Hundreds',       kv: 1 },
    { k: 'Fifties',      l: '50s',  t: 'Fifties',        kv: 1 },
    { k: 'Fours',        l: '4s',   t: 'Fours' },
    { k: 'Sixes',        l: '6s',   t: 'Sixes' },
    { k: 'Catches',      l: 'Ct',   t: 'Catches' },
    { k: 'Stumpings',    l: 'St',   t: 'Stumpings' }
  ];

  /* The WPL profile carries maidens, and counts three-wicket hauls where the
     IPL feed counts fours — so these are not quite the IPL's columns.
     services/player_stats.py names them; this is the only place they are
     ordered and labelled. */
  var BOWLING = [
    { k: 'Matches',   l: 'Mat',   t: 'Matches',            kv: 1 },
    { k: 'Innings',   l: 'Inns',  t: 'Innings bowled' },
    { k: 'Overs',     l: 'Overs', t: 'Overs bowled',       kv: 1 },
    { k: 'Maidens',   l: 'Mdns',  t: 'Maiden overs' },
    { k: 'Runs',      l: 'Runs',  t: 'Runs conceded' },
    { k: 'Wickets',   l: 'Wkts',  t: 'Wickets',            kv: 1 },
    { k: 'BBM',       l: 'BBI',   t: 'Best bowling in an innings', kv: 1 },
    { k: 'Average',   l: 'Avg',   t: 'Bowling average',    kv: 1 },
    { k: 'Econ',      l: 'Econ',  t: 'Economy rate',       kv: 1 },
    { k: 'StrikeRate', l: 'SR',   t: 'Bowling strike rate', kv: 1 },
    { k: 'ThreeWkts', l: '3w',    t: 'Three-wicket hauls' },
    { k: 'FiveWkts',  l: '5w',    t: 'Five-wicket hauls' }
  ];

  /* Each discipline plots the one measure it is actually judged on. Two
     measures of different scale never share an axis — they get a pane each. */
  var PANES = [
    { key: 'batting', title: 'Batting', cols: BATTING, plot: 'Runs',    unit: 'runs' },
    { key: 'bowling', title: 'Bowling', cols: BOWLING, plot: 'Wickets', unit: 'wickets' }
  ];

  /* A season row names the team it was played for in full. Both spellings are
     here because the profile is not consistent about the "Women" suffix. */
  var TEAM_ABV = {
    'Delhi Capitals': 'DCW', 'Delhi Capitals Women': 'DCW',
    'Gujarat Giants': 'GG', 'Gujarat Giants Women': 'GG',
    'Mumbai Indians': 'MIW', 'Mumbai Indians Women': 'MIW',
    'Royal Challengers Bengaluru': 'RCBW',
    'Royal Challengers Bengaluru Women': 'RCBW',
    'Royal Challengers Bangalore': 'RCBW',
    'UP Warriorz': 'UPW', 'UP Warriorz Women': 'UPW'
  };

  var stats = typeof statsData !== 'undefined' ? statsData : null;
  var ctl = document.getElementById('pdCtl');
  var chips = document.getElementById('pdSeasons');
  var panes = document.getElementById('pdPanes');
  if (!panes) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* The feed sends '' for "does not apply" and '-' for "no value yet". */
  function val(row, key) {
    var v = row && row[key];
    v = v == null ? '' : String(v).trim();
    return v === '' ? '—' : v;
  }

  /* Leading digits only: "4/27" plots as 4, "12.40" as 12.4, "79*" as 79. */
  function num(row, key) {
    if (!row) return 0;
    var m = String(row[key] == null ? '' : row[key]).match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  /* Seasons the player actually has a row for, newest first, as the feed sends
     them. 'Overall' is the career line and is handled separately. */
  function seasonsWith(category) {
    if (!stats || !Array.isArray(stats.years)) return [];
    return stats.years.filter(function (y) { return stats[y] && stats[y][category]; });
  }

  function anySeasons() {
    if (!stats || !Array.isArray(stats.years)) return [];
    return stats.years.filter(function (y) {
      return stats[y] && (stats[y].batting || stats[y].bowling);
    });
  }

  function teamTag(row) {
    var full = row && row.TeamName;
    if (!full) return '';
    return '<span class="pd-team">' + esc(TEAM_ABV[full] || full) + '</span>';
  }

  /* ------------------------------------------------------------ the chart */

  /* A single series of discrete seasons: one hue for every column, the
     selected season in the team accent and the rest in the de-emphasis gray.
     Values are direct-labelled only on the selected season and the career
     best — the axis, the tooltip and the table carry the others. */
  function chart(pane, years, selected) {
    if (years.length < 2) return '';     /* one column is a stat, not a chart */

    var vals = years.map(function (y) { return num(stats[y][pane.key], pane.plot); });
    var peak = Math.max.apply(null, vals);
    if (peak <= 0) return '';
    var best = vals.indexOf(peak);

    /* oldest season on the left, so the chart reads left to right in time */
    var order = years.map(function (y, i) { return i; }).reverse();

    /* On the career view no season is "the other ones", so every column wears
       the accent. Pick a season and the emphasis form kicks in: that one keeps
       the accent, the rest drop to the de-emphasis gray. */
    var all = selected === 'Overall';

    var cols = order.map(function (i) {
      var y = years[i];
      var v = vals[i];
      var on = all || y === selected;
      var show = i === best || (!all && y === selected);
      return '<div class="pd-col" data-on="' + (on ? 1 : 0) + '" tabindex="0" ' +
               'role="img" aria-label="' + esc(y + ': ' + v + ' ' + pane.unit) + '">' +
               '<span class="pd-col__tip">' + esc(y) + ' · <b>' + esc(v) + '</b> ' + esc(pane.unit) + '</span>' +
               (show ? '<span class="pd-col__val">' + esc(v) + '</span>' : '') +
               '<span class="pd-col__fill" style="height:' + Math.max(2, Math.round(v / peak * 100)) + '%"></span>' +
             '</div>';
    }).join('');

    var axis = order.map(function (i) {
      return '<span data-on="' + (all || years[i] === selected ? 1 : 0) + '">' +
             esc(years[i]) + '</span>';
    }).join('');

    return '<div class="pd-viz">' +
             '<p class="pd-viz__cap">' + esc(pane.unit.charAt(0).toUpperCase() + pane.unit.slice(1)) +
               ' per season &middot; best <b>' + esc(peak) + '</b> in ' + esc(years[best]) + '</p>' +
             /* plot and axis share one scroller so a label cannot drift off
                the column it names */
             '<div class="pd-viz__scroll pd-fade">' +
               '<div class="pd-plot">' + cols + '</div>' +
               '<div class="pd-axis">' + axis + '</div>' +
             '</div>' +
           '</div>';
  }

  /* ------------------------------------------------------------ the table */

  function table(pane, years, selected) {
    var head = pane.cols.map(function (c) {
      return '<th scope="col"><abbr title="' + esc(c.t) + '">' + esc(c.l) + '</abbr></th>';
    }).join('');

    function row(y, cls) {
      var data = y === 'Overall' ? (stats.Overall || {})[pane.key] : stats[y][pane.key];
      if (!data) return '';
      var cells = pane.cols.map(function (c) { return '<td>' + esc(val(data, c.k)) + '</td>'; }).join('');
      return '<tr class="' + cls + '"><td><span class="pd-year">' +
             esc(y === 'Overall' ? 'Career' : y) + '</span>' + teamTag(data) + '</td>' + cells + '</tr>';
    }

    var body = row('Overall', 'is-career') +
      years.map(function (y) { return row(y, y === selected ? 'is-on' : ''); }).join('');

    return '<div class="pd-scroll"><table class="pd-table">' +
             '<thead><tr><th scope="col">Season</th>' + head + '</tr></thead>' +
             '<tbody>' + body + '</tbody>' +
           '</table></div>';
  }

  /* The phone view of the same numbers — not a tooltip-only shortcut, the
     values are all here too. */
  function kv(pane, selected) {
    var data = selected === 'Overall'
      ? (stats.Overall || {})[pane.key]
      : (stats[selected] || {})[pane.key];
    if (!data) {
      return '<div class="pd-kv"><div class="pd-kv__grid"><div class="pd-kv__cell">' +
             '<b>—</b><span>Did not ' + (pane.key === 'bowling' ? 'bowl' : 'bat') +
             ' in ' + esc(selected) + '</span></div></div></div>';
    }
    var cells = pane.cols.filter(function (c) { return c.kv; }).map(function (c) {
      return '<div class="pd-kv__cell"><b>' + esc(val(data, c.k)) + '</b><span>' + esc(c.t) + '</span></div>';
    }).join('');
    return '<div class="pd-kv"><div class="pd-kv__grid">' + cells + '</div></div>';
  }

  /* --------------------------------------------------------------- render */

  function render(selected) {
    var html = '';

    PANES.forEach(function (pane) {
      var years = seasonsWith(pane.key);
      var career = (stats.Overall || {})[pane.key];
      if (!years.length && !career) return;
      /* The feed carries a zeroed career row for a discipline the player has
         never taken part in — a batter who has never bowled. A pane of dashes
         says nothing, so drop it unless there is at least one innings. */
      if (!years.length && num(career, 'Innings') <= 0) return;

      var sub = years.length
        ? '<span class="pd-pane__sub"><b>' + years.length + '</b> season' +
          (years.length === 1 ? '' : 's') + '</span>'
        : '<span class="pd-pane__sub">Career total only</span>';

      html += '<section class="pd-pane">' +
                '<div class="pd-pane__head">' +
                  '<h3 class="pd-pane__title">' + pane.title + '</h3>' + sub +
                '</div>' +
                chart(pane, years, selected) +
                table(pane, years, selected) +
                kv(pane, selected) +
              '</section>';
    });

    panes.innerHTML = html || empty();
    reveal();                 /* position first, then read the edges off it */
    watchFades(panes);
  }

  /* ----------------------------------------------------------- edge fades */

  /* Which side still has content out of view. 'end' means there is more to the
     right, 'start' more to the left, 'none' that it all fits — so the fade is
     never showing where the content has actually ended. */
  var faders = [];

  function markEdges(box) {
    var max = box.scrollWidth - box.clientWidth;
    if (max <= 1) { box.setAttribute('data-fade', 'none'); return; }
    var atStart = box.scrollLeft <= 1;
    var atEnd = box.scrollLeft >= max - 1;
    box.setAttribute('data-fade', atStart ? 'end' : atEnd ? 'start' : 'both');
  }

  function watchFades(root) {
    faders = faders.filter(function (b) { return b.isConnected; });
    Array.prototype.forEach.call(root.querySelectorAll('.pd-fade'), function (box) {
      if (faders.indexOf(box) < 0) {
        faders.push(box);
        box.addEventListener('scroll', function () { markEdges(box); }, { passive: true });
      }
      markEdges(box);
    });
  }

  function refreshFades() { faders.forEach(function (b) { markEdges(b); }); }

  /* The panes can change width without the window doing so — a scrollbar
     appearing, or the chips row rewrapping — so observe the boxes too. */
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(refreshFades);
    ro.observe(panes);
    if (ctl) ro.observe(ctl);
  }
  window.addEventListener('resize', refreshFades, { passive: true });

  /* Park each chart's scroll where the reader needs it: on the season they
     picked, or on the most recent ones when they are looking at the career.
     Set scrollLeft rather than scrollIntoView(), which would also drag the
     page up or down to reach the chart. */
  function reveal() {
    Array.prototype.forEach.call(panes.querySelectorAll('.pd-viz__scroll'), function (box) {
      var plot = box.querySelector('.pd-plot');
      /* the plot's own laid-out width, not box.scrollWidth: the latter counts
         absolutely positioned tooltips, which are not content to scroll to */
      if (!plot || plot.getBoundingClientRect().width <= box.clientWidth + 1) return;
      var cols = box.querySelectorAll('.pd-col');
      var on = box.querySelectorAll('.pd-col[data-on="1"]');
      if (on.length === cols.length) {        /* career view: newest is at the right */
        box.scrollLeft = box.scrollWidth;
      } else if (on.length) {
        box.scrollLeft = Math.max(0, on[0].offsetLeft - (box.clientWidth - on[0].offsetWidth) / 2);
      }
    });
  }

  /* A capped player with no figures means the feed came back empty, which is a
     different thing from never having played — and the bio above already shows
     their debut season, so the two must not contradict each other. */
  function empty() {
    var capped = panes.dataset.capped === '1';
    return '<div class="pd-empty">' +
             '<span class="material-icons-round">query_stats</span>' +
             '<span class="pd-empty__title">' +
               (capped ? 'Figures unavailable' : 'No WPL record yet') + '</span>' +
             '<span class="pd-empty__text">' +
               (capped
                 ? 'This player&rsquo;s season-by-season record could not be loaded just now. ' +
                   'Try again shortly.'
                 : 'This player is yet to appear in a WPL match. Batting and bowling ' +
                   'figures will show here from their first game.') +
             '</span>' +
           '</div>';
  }

  function pick(season) {
    Array.prototype.forEach.call(chips.querySelectorAll('.pd-chip'), function (b) {
      b.setAttribute('aria-selected', String(b.dataset.season === season));
    });
    render(season);
  }

  /* ----------------------------------------------------------------- init */

  var years = anySeasons();
  var career = stats && stats.Overall && (stats.Overall.batting || stats.Overall.bowling);

  if (!years.length && !career) {
    panes.innerHTML = empty();
    return;
  }

  if (years.length) {
    var list = ['Overall'].concat(years);
    chips.innerHTML = list.map(function (y) {
      return '<button type="button" class="pd-chip" role="tab" data-season="' + esc(y) + '" ' +
             'aria-selected="' + (y === 'Overall') + '">' +
             esc(y === 'Overall' ? 'Career' : y) + '</button>';
    }).join('');
    ctl.hidden = false;
    watchFades(ctl);          /* only measurable once ctl is no longer hidden */

    chips.addEventListener('click', function (e) {
      var btn = e.target.closest('.pd-chip');
      if (btn) pick(btn.dataset.season);
    });

    /* left/right walk the chips, the way a tablist is expected to behave */
    chips.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var all = Array.prototype.slice.call(chips.querySelectorAll('.pd-chip'));
      var at = all.indexOf(document.activeElement);
      if (at < 0) return;
      e.preventDefault();
      var next = all[(at + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      next.focus();
      pick(next.dataset.season);
    });
  }

  render('Overall');
}());

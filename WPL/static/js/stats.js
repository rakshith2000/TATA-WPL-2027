/* ==========================================================================
   WPL 2027 · Stats
   One renderer for all three leaderboard pages.

   Every category is a column spec rather than a hand-written table builder,
   so batting, bowling and awards share the same sorting, search, podium and
   empty states — and a new leaderboard is one entry in CATS below.

   Data comes from /api/stats (the Toppers table), exactly as before, and the
   ?option= deep links the home page uses still select a category.
   ========================================================================== */

(function () {
  'use strict';

  var app = document.getElementById('stApp');
  if (!app) return;

  var PAGE = app.getAttribute('data-page');          /* batting | bowling | awards */
  var CLR = window.WPL_CLR || {};                    /* brand colours, from main.py */
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ====================================================== column helpers */

  function col(k, l, t, type) {
    return { k: k, l: l, t: t || l, type: type || 'num' };
  }

  /* The feed's own field names - same feed and same names as the IPL's, so a
     column spec reads identically in both apps. */
  var VS = col('AgaintsTeamCode', 'Vs', 'Opposition', 'team');
  var VENUE = col('VenueName', 'Venue', 'Venue', 'text');

  /* batting */
  var M = col('Matches', 'M', 'Matches');
  var INN = col('Innings', 'I', 'Innings');
  var NO = col('NotOuts', 'NO', 'Not outs');
  var RUNS = col('TotalRuns', 'R', 'Runs');
  var HS = col('HighestScore', 'HS', 'Highest score');
  var AVG = col('BattingAverage', 'Avg', 'Batting average');
  var SR = col('StrikeRate', 'SR', 'Strike rate');
  var C100 = col('Centuries', '100s', 'Hundreds');
  var C50 = col('FiftyPlusRuns', '50s', 'Fifties');
  var FOUR = col('Fours', '4s', 'Fours');
  var SIX = col('Sixes', '6s', 'Sixes');
  var BF = col('Balls', 'BF', 'Balls faced');

  /* bowling */
  var OV = col('OversBowled', 'O', 'Overs bowled');
  var RC = col('TotalRunsConceded', 'R', 'Runs conceded');
  var WKT = col('Wickets', 'W', 'Wickets');
  var BBI = col('BBIW', 'BBI', 'Best bowling in an innings', 'bbi');
  var BAVG = col('BowlingAverage', 'Avg', 'Bowling average');
  var ECO = col('EconomyRate', 'Eco', 'Economy rate');
  var BSR = col('BowlingSR', 'SR', 'Bowling strike rate');
  var W4 = col('FourWickets', '4W', 'Four-wicket hauls');
  var W5 = col('FiveWickets', '5W', 'Five-wicket hauls');
  var IRUNS = col('InningsRuns', 'R', 'Runs conceded');
  var IWKT = col('InningsWickets', 'W', 'Wickets');

  /* Player-name and team-code fields differ per feed; `subject: 'team'` means
     the rows are franchises, so there is no player profile to link to. */
  var BAT = { name: 'StrikerName', team: 'TeamCode' };
  var BOWL = { name: 'BowlerName', team: 'TeamCode' };

  function bat(o) { o.name = BAT.name; o.team = BAT.team; return o; }
  function bowl(o) { o.name = BOWL.name; o.team = BOWL.team; return o; }

  /* ========================================================== categories */

  /* Order matters: it is the order of the page menu, and it has to match the
     categories config.json's stats_list seeds into the Toppers table - an id
     here with no row there is a leaderboard that will always be empty.

     The IPL's list, unchanged, because it is the same feed. The one addition
     is Most POTM, which is counted from our own results rather than fetched. */
  var CATS = {
    batting: [
      bat({ id: 'Most Runs', unit: 'Runs', blurb: 'Who has scored the most this season',
            cols: [RUNS, M, INN, NO, HS, AVG, SR, C100, C50, FOUR, SIX] }),
      bat({ id: 'Most Sixes', unit: 'Sixes', blurb: 'The cleanest strikers of the season',
            cols: [SIX, M, INN, RUNS, HS, AVG, SR, C100, C50, FOUR] }),
      bat({ id: 'Most Sixes (Innings)', unit: 'Sixes', innings: true, blurb: 'Most sixes in a single innings',
            cols: [SIX, RUNS, BF, SR, FOUR, VS, VENUE] }),
      bat({ id: 'Most Fours', unit: 'Fours', blurb: 'Boundary hitters of the season',
            cols: [FOUR, M, INN, RUNS, HS, AVG, SR, C100, C50, SIX] }),
      bat({ id: 'Most Fours (Innings)', unit: 'Fours', innings: true, blurb: 'Most fours in a single innings',
            cols: [FOUR, RUNS, BF, SR, SIX, VS, VENUE] }),
      bat({ id: 'Most 50s', unit: '50s', blurb: 'The most consistent scorers',
            cols: [C50, RUNS, M, INN, NO, HS, AVG, SR, C100, FOUR, SIX] }),
      bat({ id: 'Most 100s', unit: '100s', blurb: 'Hundreds, the rarest currency in T20',
            cols: [C100, RUNS, M, INN, NO, HS, AVG, SR, C50, FOUR, SIX] }),
      bat({ id: 'Fastest 50s', unit: 'Balls', innings: true, asc: true, blurb: 'Fifty off the fewest balls',
            cols: [BF, SR, VS, VENUE] }),
      bat({ id: 'Fastest 100s', unit: 'Balls', innings: true, asc: true, blurb: 'Hundred off the fewest balls',
            cols: [BF, SR, VS, VENUE] }),
      bat({ id: 'Highest Scores', unit: 'Runs', innings: true, blurb: 'The biggest individual innings',
            cols: [RUNS, BF, SR, FOUR, SIX, VS, VENUE] }),
      bat({ id: 'Best Strike Rate', unit: 'SR', blurb: 'Runs per hundred balls, across the season',
            cols: [SR, M, INN, RUNS, HS, AVG, C100, C50, FOUR, SIX] }),
      bat({ id: 'Best Strike Rate (Innings)', unit: 'SR', innings: true, blurb: 'The most explosive single innings',
            cols: [SR, RUNS, BF, FOUR, SIX, VS, VENUE] }),
      bat({ id: 'Best Batting Averages', unit: 'Avg', blurb: 'Runs per dismissal, across the season',
            cols: [AVG, M, INN, RUNS, HS, SR, C100, C50, FOUR, SIX] })
    ],

    bowling: [
      bowl({ id: 'Most Wickets', unit: 'Wkts', blurb: 'The leading wicket takers',
             cols: [WKT, M, INN, OV, RC, BBI, BAVG, ECO, BSR, W4, W5] }),
      bowl({ id: 'Most Maidens', unit: 'Mdns', blurb: 'Overs that cost nothing at all',
             cols: [col('Maidens', 'Mdns', 'Maiden overs'), M, INN, OV, RC, WKT, BAVG, ECO, BSR, W4, W5] }),
      bowl({ id: 'Most Dot Balls', unit: 'Dots', blurb: 'Pressure, one dot at a time',
             cols: [col('DotBallsBowled', 'Dots', 'Dot balls'), M, INN, OV, RC, WKT, BAVG, ECO, BSR, W4, W5] }),
      bowl({ id: 'Most Dot Balls (Innings)', unit: 'Dots', innings: true, blurb: 'Most dot balls in a single spell',
             cols: [col('DotBallsBowled', 'Dots', 'Dot balls'), OV, IRUNS, IWKT, BSR, VS, VENUE] }),
      bowl({ id: 'Best Bowling Averages', unit: 'Avg', asc: true, blurb: 'Runs conceded per wicket',
             cols: [BAVG, M, INN, OV, RC, WKT, BBI, ECO, BSR, W4, W5] }),
      bowl({ id: 'Best Bowling Economy', unit: 'Eco', asc: true, blurb: 'The most miserly bowlers of the season',
             cols: [ECO, M, INN, OV, RC, WKT, BBI, BAVG, BSR, W4, W5] }),
      bowl({ id: 'Best Bowling Economy (Innings)', unit: 'Eco', innings: true, asc: true,
             blurb: 'The tightest single spells',
             cols: [ECO, OV, IRUNS, IWKT, BSR, VS, VENUE] }),
      bowl({ id: 'Best Bowling Strike Rate', unit: 'SR', asc: true, blurb: 'Balls per wicket, across the season',
             cols: [BSR, M, INN, OV, RC, WKT, BBI, BAVG, W4, W5] }),
      bowl({ id: 'Best Bowling Strike Rate (Innings)', unit: 'SR', innings: true, asc: true,
             blurb: 'Balls per wicket in a single spell',
             cols: [BSR, OV, IRUNS, IWKT, VS, VENUE] }),
      bowl({ id: 'Best Bowling Figures', unit: 'BBI', innings: true, blurb: 'The best spells of the season',
             cols: [BBI, OV, IRUNS, IWKT, SR, VS, VENUE] }),
      bowl({ id: 'Most Runs Conceded (Innings)', unit: 'Runs', innings: true, blurb: 'The most expensive spells',
             cols: [IRUNS, OV, IWKT, SR, VS, VENUE] }),
      bowl({ id: 'Most Hat-tricks', unit: 'Hat-tricks', blurb: 'Three in three',
             cols: [col('Hattricks', 'Hat-tricks', 'Hat-tricks'), M, INN, OV, RC, WKT, BAVG, ECO, BSR, W4, W5] })
    ],

    awards: [
      { id: 'Most Valuable Players', unit: 'Pts', name: 'PlayerName', team: 'TeamCode',
        blurb: 'Every contribution with bat, ball and in the field, in one number',
        cols: [col('IndexValue', 'Pts', 'MVP points'), M, WKT, col('DotBalls', 'Dots', 'Dot balls'),
               FOUR, SIX, col('caught', 'Ct', 'Catches'), col('RunOut', 'RO', 'Run outs'),
               col('Stumping', 'St', 'Stumpings')] },
      { id: 'Fair Play Award', unit: 'Pts', subject: 'team', name: 'TeamFullName', team: 'TeamName',
        blurb: 'Umpires score both sides after every match',
        cols: [col('Points', 'Pts', 'Total points'), col('No', 'M', 'Matches rated'),
               col('AvePoints', 'Avg', 'Average points per match')] },
      { id: 'Most POTM', unit: 'Awards', name: 'name', team: 'team',
        blurb: 'Player of the match, most often',
        cols: [col('potm', 'POTM', 'Player-of-the-match awards'), col('matches', 'M', 'Matches'),
               col('innings', 'I', 'Innings'), col('runs', 'R', 'Runs'),
               col('wickets', 'W', 'Wickets')] }
    ]
  };

  var PAGE_META = {
    batting: { icon: 'sports_cricket', acc: '#ff8a24', label: 'Batting' },
    bowling: { icon: 'sports_baseball', acc: '#c77dff', label: 'Bowling' },
    awards: { icon: 'workspace_premium', acc: '#ffc247', label: 'Awards' }
  };

  var LIST = CATS[PAGE] || [];
  var META = PAGE_META[PAGE] || PAGE_META.batting;

  /* ============================================================== values */

  function raw(row, k) {
    var v = row ? row[k] : null;
    return (v === undefined || v === null) ? '' : String(v).trim();
  }

  function numOf(s) {
    if (s === '' || s === '-') return null;
    var n = parseFloat(String(s).replace(/[*,\s]/g, ''));
    return isNaN(n) ? null : n;
  }

  /* "5/17" ranks on wickets first, then fewest runs — the way a scorecard reads */
  function bbiOf(s) {
    var p = String(s).split('/');
    if (p.length !== 2) return null;
    var w = parseFloat(p[0]), r = parseFloat(p[1]);
    return (isNaN(w) || isNaN(r)) ? null : w * 1000 - r;
  }

  function valueOf(row, c) {
    var s = raw(row, c.k);
    if (c.type === 'bbi') return bbiOf(s);
    if (c.type === 'num') return numOf(s);
    return s.toLowerCase();
  }

  /* ============================================================== markup */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* Mirrors crest_grad() in templates/macros/points.html — same two brand
     colours per team, so a crest here matches the one on every other page. */
  function crestGrad(code) {
    var c = CLR[code];
    if (!c) return '--team-a: #502a3f; --team-b: #301323;';
    var a, b;
    if (code === 'RCBW') { a = c.c3; b = c.c1; }
    else if (code === 'UPW') { a = c.c1; b = c.c3; }
    else { a = c.c1; b = c.c2; }
    return '--team-a: ' + a + '; --team-b: ' + b + ';';
  }

  function crestUrl(code) {
    return '/static/images/squad_logos/' + encodeURIComponent(code || 'TBA') + '.png';
  }

  function profileUrl(code, name) {
    return '/team-' + encodeURIComponent(code) + '/squad_details/' + encodeURIComponent(name);
  }

  var FALLBACK = "this.onerror=null;this.src='/static/images/Default.png';this.classList.add('is-fallback');";

  /* ======================================================= page elements */

  var elTitle = document.getElementById('stTitle');
  var elSub = document.getElementById('stSub');
  var elDdVal = document.getElementById('stDdVal');
  var elDd = document.getElementById('stDd');
  var elMenu = document.getElementById('stMenu');
  var elPodium = document.getElementById('stPodium');
  var elCard = document.getElementById('stCard');
  var elScroll = document.getElementById('stScroll');
  var elTable = document.getElementById('stTable');
  var elHead = document.getElementById('stHead');
  var elBody = document.getElementById('stBody');
  var elState = document.getElementById('stState');
  var elShown = document.getElementById('stShown');
  var elSearch = document.getElementById('stSearch');
  var elClear = document.getElementById('stClear');
  var elReset = document.getElementById('stReset');
  var elNote = document.getElementById('stNote');

  var DATA = null;          /* every category, as delivered */
  var cat = LIST[0];        /* the category on screen */
  var sort = null;          /* { i: colIndex, dir: 1 | -1 } — null is feed order */
  var query = '';

  /* ================================================================ menu */

  function buildMenu() {
    elMenu.innerHTML = LIST.map(function (c, i) {
      return '<button type="button" class="st-opt" role="option" data-i="' + i + '">' +
             '<span class="st-opt__name">' + esc(c.id) + '</span>' +
             '<span class="material-icons-round st-opt__tick">check</span>' +
             '</button>';
    }).join('');

    Array.prototype.forEach.call(elMenu.querySelectorAll('.st-opt'), function (btn) {
      btn.addEventListener('click', function () {
        elDd.open = false;
        show(LIST[parseInt(btn.getAttribute('data-i'), 10)], true);
      });
    });
  }

  function syncMenu() {
    Array.prototype.forEach.call(elMenu.querySelectorAll('.st-opt'), function (btn, i) {
      var on = LIST[i].id === cat.id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', String(on));
    });
  }

  /* ============================================================== podium */

  function podium(rows) {
    var top = rows.slice(0, 3);
    if (!top.length) { elPodium.innerHTML = ''; elPodium.hidden = true; return; }
    elPodium.hidden = false;

    var MEDAL = ['1st', '2nd', '3rd'];
    var lead = cat.cols[0];

    elPodium.innerHTML = top.map(function (row, i) {
      var code = raw(row, cat.team);
      var name = raw(row, cat.name);
      var isTeam = cat.subject === 'team';
      var face = isTeam
        ? '<span class="st-lead__face st-lead__face--crest" style="' + crestGrad(code) + '">' +
          '<img src="' + crestUrl(code) + '" alt="" loading="lazy"></span>'
        : '<span class="st-lead__face" style="' + crestGrad(code) + '">' +
          '<img src="/static/images/squads/' + encodeURIComponent(code) + '-MICRO/' +
          encodeURIComponent(name.replace(/ /g, '-')) + '.png" alt="" loading="lazy" onerror="' + FALLBACK + '">' +
          '</span>';

      var team = isTeam ? '' :
        '<span class="st-lead__team"><img src="' + crestUrl(code) + '" alt="">' + esc(code) + '</span>';

      var inner =
        face +
        '<span class="st-lead__id">' +
          '<span class="st-medal">' + MEDAL[i] + '</span>' +
          '<span class="st-lead__name">' + esc(name) + '</span>' +
          team +
        '</span>' +
        '<span class="st-lead__val"><b>' + esc(raw(row, lead.k) || '-') + '</b><span>' +
          esc(cat.unit || lead.l) + '</span></span>';

      var attrs = 'class="st-lead st-lead--' + (i + 1) + '" style="' + crestGrad(code) + '"';
      return isTeam
        ? '<div ' + attrs + '>' + inner + '</div>'
        : '<a ' + attrs + ' href="' + profileUrl(code, name) + '">' + inner + '</a>';
    }).join('');
  }

  /* =============================================================== table */

  function buildHead() {
    var html = '<tr><th scope="col"><span class="st-th st-th--plain">#</span></th>' +
               '<th scope="col">' +
               thButton(-1, cat.subject === 'team' ? 'Team' : 'Player', 'name', 'st-th--left') + '</th>';
    cat.cols.forEach(function (c, i) {
      html += '<th scope="col" class="' + (i === 0 ? 'is-lead' : '') + '">' + thButton(i, c.l, c.t) + '</th>';
    });
    elHead.innerHTML = html + '</tr>';

    Array.prototype.forEach.call(elHead.querySelectorAll('.st-th[data-i]'), function (btn) {
      btn.addEventListener('click', function () {
        clickSort(parseInt(btn.getAttribute('data-i'), 10));
      });
    });
  }

  function thButton(i, label, title, mod) {
    return '<button type="button" class="st-th ' + (mod || '') + '" data-i="' + i +
           '" title="Sort by ' + esc(title) + '">' +
           esc(label) + '<span class="material-icons-round st-th__i">unfold_more</span></button>';
  }

  function clickSort(i) {
    /* First click sorts the way the stat is read: most runs first, but best
       average or economy lowest first. Clicking again flips it. */
    var c = i < 0 ? null : cat.cols[i];
    var down = c ? !(c.type === 'text' || c.type === 'team' || (i === 0 && cat.asc)) : false;
    if (sort && sort.i === i) sort = { i: i, dir: -sort.dir };
    else sort = { i: i, dir: down ? -1 : 1 };
    paint();
  }

  function syncHead() {
    Array.prototype.forEach.call(elHead.querySelectorAll('th'), function (th, n) {
      var i = n - 2;                                  /* rank, name, then columns */
      var on = sort && (sort.i === i || (sort.i === -1 && n === 1));
      th.classList.toggle('is-sorted', !!on);
      th.setAttribute('aria-sort', on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
      var icon = th.querySelector('.st-th__i');
      if (icon) icon.textContent = on ? (sort.dir === 1 ? 'arrow_upward' : 'arrow_downward') : 'unfold_more';
    });
  }

  function rowHtml(row, pos) {
    var code = raw(row, cat.team);
    var name = raw(row, cat.name);
    var isTeam = cat.subject === 'team';

    var who =
      '<span class="st-who__crest" style="' + crestGrad(code) + '">' +
        '<img src="' + crestUrl(code) + '" alt="' + esc(code) + '" loading="lazy">' +
      '</span>' +
      '<span class="st-who__names"><span class="st-who__name">' + esc(name) + '</span>' +
      (isTeam ? '' : '<span class="st-who__team">' + esc(code) + '</span>') + '</span>';

    var cells = cat.cols.map(function (c, i) {
      var v = raw(row, c.k);
      if (c.type === 'team') {
        return '<td>' + (v && v !== '-'
          ? '<span class="st-vs"><img src="' + crestUrl(v) + '" alt="">' + esc(v) + '</span>'
          : '<span class="st-num--zero">&ndash;</span>') + '</td>';
      }
      if (c.type === 'text') {
        return '<td><span class="st-venue" title="' + esc(v) + '">' + esc(v || '-') + '</span></td>';
      }
      var zero = (v === '' || v === '-' || v === '0');
      return '<td class="' + (i === 0 ? 'is-lead' : 'st-num') + (zero && i !== 0 ? ' st-num--zero' : '') + '">' +
             esc(v === '' ? '-' : v) + '</td>';
    }).join('');

    return '<tr>' +
      '<td><span class="st-rank' + (pos <= 3 ? ' st-rank--' + pos : '') + '">' + pos + '</span></td>' +
      '<td>' + (isTeam
        ? '<span class="st-who">' + who + '</span>'
        : '<a class="st-who" href="' + profileUrl(code, name) + '">' + who + '</a>') + '</td>' +
      cells + '</tr>';
  }

  /* ============================================================== paint */

  function paint() {
    var rows = (DATA && DATA[cat.id]) || [];

    if (query) {
      rows = rows.filter(function (r) {
        return (raw(r, cat.name) + ' ' + raw(r, cat.team)).toLowerCase().indexOf(query) !== -1;
      });
    }

    if (sort) {
      var c = sort.i < 0 ? null : cat.cols[sort.i];
      rows = rows.slice().sort(function (a, b) {
        var va = c ? valueOf(a, c) : raw(a, cat.name).toLowerCase();
        var vb = c ? valueOf(b, c) : raw(b, cat.name).toLowerCase();
        /* blanks sink to the bottom whichever way the column is pointing */
        var ea = (va === null || va === ''), eb = (vb === null || vb === '');
        if (ea && eb) return 0;
        if (ea) return 1;
        if (eb) return -1;
        if (va < vb) return -sort.dir;
        if (va > vb) return sort.dir;
        return 0;
      });
    }

    elBody.innerHTML = rows.map(function (r, i) { return rowHtml(r, i + 1); }).join('');
    if (elShown) elShown.textContent = rows.length;
    syncHead();

    if (rows.length) {
      elState.hidden = true;
      elCard.hidden = false;
    } else {
      state(query ? 'search_off' : 'query_stats',
            query ? 'Nobody matches that' : 'Nothing here yet',
            query ? 'No player or team matches “' + query + '” in this leaderboard.'
                  : 'This leaderboard fills up once the season gets under way.');
    }

    if (elReset) elReset.hidden = !(sort || query);
  }

  function state(icon, title, text, isError) {
    elState.className = 'st-state' + (isError ? ' st-state--error' : '');
    elState.innerHTML =
      '<span class="material-icons-round">' + icon + '</span>' +
      '<span class="st-state__title">' + esc(title) + '</span>' +
      '<span class="st-state__text">' + esc(text) + '</span>' +
      (isError ? '<button type="button" class="st-retry" id="stRetry">Try again</button>' : '');
    elState.hidden = false;
    elCard.hidden = true;
    var retry = document.getElementById('stRetry');
    if (retry) retry.addEventListener('click', load);
  }

  /* ============================================================ category */

  /* Drop the columns this leaderboard has nothing in.

     Cricbuzz does not publish the same columns for every board — its most-runs
     table carries no highest score, several carry no maidens — and a column of
     dashes reads as missing data rather than as a column that does not apply.
     The spec above lists everything a board could carry and this keeps what it
     actually does, so the table fits whatever the feed sent. A board with no
     rows at all keeps its full spec: there is nothing to judge it on, and the
     header is still worth showing. */
  function usedCols(spec, rows) {
    if (!rows || !rows.length) return spec;
    var kept = spec.filter(function (c) {
      return rows.some(function (r) { return raw(r, c.k) !== ''; });
    });
    /* never strip the headline column — it is what the board is ranked on */
    return kept.length ? kept : [spec[0]];
  }

  function show(next, fromUser) {
    if (!next) return;
    /* a shallow copy, so trimming one board's columns cannot leak into the
       shared column objects or into the next board shown */
    cat = Object.assign({}, next, {
      cols: usedCols(next.cols, (DATA && DATA[next.id]) || [])
    });
    sort = null;
    query = '';
    if (elSearch) elSearch.value = '';
    if (elClear) elClear.hidden = true;

    elTitle.textContent = cat.id;
    elSub.textContent = cat.blurb;
    elDdVal.textContent = cat.id;
    if (elNote) {
      elNote.innerHTML = cat.innings
        ? 'Single-innings records. <b>Click any column</b> to re-rank the table.'
        : 'Season totals. <b>Click any column</b> to re-rank the table.';
    }

    syncMenu();
    buildHead();
    podium((DATA && DATA[cat.id]) || []);
    paint();

    if (fromUser) {
      syncUrl();
      /* a menu pick should show the new table, not leave you mid-page */
      var y = app.getBoundingClientRect().top + window.pageYOffset - 90;
      window.scrollTo({ top: y < 0 ? 0 : y, behavior: still ? 'auto' : 'smooth' });
    }
  }

  function syncUrl() {
    if (!window.history || !history.replaceState) return;
    try {
      var u = new URL(location.href);
      if (cat.id === LIST[0].id) u.searchParams.delete('option');
      else u.searchParams.set('option', cat.id);
      history.replaceState(null, '', u.toString());
    } catch (e) { /* ignore */ }
  }

  function fromUrl() {
    var asked = null;
    try { asked = new URLSearchParams(location.search).get('option'); } catch (e) { /* ignore */ }
    if (!asked) return LIST[0];
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === asked) return LIST[i];
    return LIST[0];
  }

  /* ================================================================ load */

  function load() {
    elCard.hidden = true;
    elPodium.hidden = true;
    /* a skeleton the shape of the table, so nothing jumps when it arrives */
    elState.className = 'st-state st-state--load';
    elState.innerHTML = '<div class="st-skel">' +
      new Array(10).join('<div class="st-skel__row"></div>') + '</div>';
    elState.hidden = false;

    fetch('/api/stats', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        DATA = (d && d.stats) || {};
        show(fromUrl(), false);
      })
      .catch(function () {
        state('cloud_off', 'Could not load the stats',
              'The leaderboard feed did not answer. Check your connection and try again.', true);
      });
  }

  /* ============================================================ controls */

  if (elSearch) {
    var typing = null;
    elSearch.addEventListener('input', function () {
      clearTimeout(typing);
      typing = setTimeout(function () {
        query = elSearch.value.toLowerCase().trim();
        if (elClear) elClear.hidden = !query;
        paint();
      }, 120);
    });
    elSearch.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && elSearch.value) {
        elSearch.value = '';
        query = '';
        if (elClear) elClear.hidden = true;
        paint();
        e.preventDefault();
      }
    });
  }

  if (elClear) {
    elClear.addEventListener('click', function () {
      elSearch.value = '';
      query = '';
      elClear.hidden = true;
      elSearch.focus();
      paint();
    });
  }

  if (elReset) {
    elReset.addEventListener('click', function () {
      sort = null;
      query = '';
      if (elSearch) elSearch.value = '';
      if (elClear) elClear.hidden = true;
      paint();
    });
  }

  document.addEventListener('click', function (e) {
    if (elDd.open && !elDd.contains(e.target)) elDd.open = false;
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && elDd.open) {
      elDd.open = false;
      elDd.querySelector('summary').focus();
    }
  });

  /* sticky toolbar under the fixed navbar */
  function navHeight() {
    var nav = document.querySelector('nav.navbar');
    return nav ? nav.getBoundingClientRect().height : 66;
  }

  function syncStick() {
    document.documentElement.style.setProperty('--st-stick', (navHeight() + 8) + 'px');
  }

  syncStick();
  window.addEventListener('resize', syncStick);

  /* drop-shadow on the frozen columns once the table is scrolled sideways */
  if (elScroll) {
    var syncShadow = function () {
      elScroll.classList.toggle('is-scrolled', elScroll.scrollLeft > 4);
    };
    elScroll.addEventListener('scroll', syncShadow, { passive: true });
    syncShadow();
  }

  /* back to top */
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

  var bar = document.getElementById('stBar');
  var barTop = bar ? bar.offsetTop : 0;
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

  /* ================================================================ boot */

  document.documentElement.style.setProperty('--st-acc', META.acc);
  buildMenu();
  load();
})();

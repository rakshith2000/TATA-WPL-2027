/* ==========================================================================
   WPL 2027 · Live Match Centre — shell controller
   --------------------------------------------------------------------------
   Owns everything outside the panels: the scoreboard, the tab strip, the
   polling loop and the freshness indicator. Each panel is rendered by its own
   script (info.js, live.js, scorecard.js, overs.js, livesquad.js), which this
   file loads on demand and calls with the payload it already fetched.

   Everything the feed sends is third-party text, so it is escaped on the way
   into the DOM. window.MX carries the handful of helpers the panels share.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------- constants */

  var TABS = ['matchInfo', 'liveScore', 'scoreCard', 'Overs', 'Graphs', 'liveSquad'];

  var PANEL = {
    matchInfo: { file: 'info.js', fn: 'renderTabInfo' },
    liveScore: { file: 'live.js', fn: 'renderTabLive' },
    scoreCard: { file: 'scorecard.js', fn: 'renderTabScorecard' },
    Overs: { file: 'overs.js', fn: 'renderTabOvers' },
    Graphs: { file: 'graphs.js', fn: 'renderTabGraphs' },
    liveSquad: { file: 'livesquad.js', fn: 'renderTabSquad' }
  };

  var POLL_MS = 8000;          /* the feed itself updates about this often */
  var WARMUP_MS = 60000;       /* before the first ball: toss and XI only */
  var DEFAULT_TAB = 'matchInfo';
  var ENDED = /\b(won|abandoned|no result|tied|drawn)\b/i;

  /* ----------------------------------------------------------------- state */

  var currentTab = DEFAULT_TAB;
  var pollTimer = null;
  var ageTimer = null;
  var clockTimer = null;
  var pending = 0;             /* requests in flight */
  var reqToken = 0;            /* only the newest request may paint */
  var startFired = false;      /* the countdown has already asked for a reload */
  var paused = false;
  var lastAt = 0;              /* when the last successful poll landed */
  var stale = false;           /* the last poll failed — say so, keep the data */
  var liveNow = false;         /* the match is in progress, so keep polling */
  var nearStart = false;       /* start time is close — poll slowly for a toss */
  var baseTitle = document.title;

  var boardEl = document.getElementById('scoreboard-root');
  var panelEl = document.getElementById('tab-content');
  var barEl = document.getElementById('mxTabs');
  var refreshEl = document.getElementById('mxRefresh');
  var ageEl = document.getElementById('mxAge');
  var toggleEl = document.getElementById('mxToggle');
  var toastEl = document.getElementById('mxToast');

  /* --------------------------------------------------------------- helpers */

  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* The two brand colours behind a crest — the same per-team picks the
     fixtures list and the points table use. `map` is the feed payload's
     colour dictionary, which a few panels do not carry at all. */
  function tint(team, map) {
    var c = map && map[team];
    if (!c || typeof c !== 'object') return '--c1: #ff4fa8; --c2: #c77dff;';
    var a, b;
    if (team === 'RCBW') { a = c.c3; b = c.c1; }
    else if (team === 'UPW') { a = c.c1; b = c.c3; }
    else { a = c.c1; b = c.c2; }
    return '--c1: ' + esc(a || '#ff4fa8') + '; --c2: ' + esc(b || '#c77dff') + ';';
  }

  /* Crest badge. The abbreviation sits under the logo, so teams with no
     squad_logos file (a guest fixture, TBA) still render as a badge. */
  function crest(team, map, cls) {
    return '<span class="mx-crest ' + (cls || '') + '" style="' + tint(team, map) + '">' +
             '<img src="/static/images/squad_logos/' + encodeURIComponent(team) + '.png" alt="" ' +
                  'loading="lazy" onerror="this.remove();">' +
           '</span>';
  }

  function playerHref(team, name) {
    return '/team-' + encodeURIComponent(team) + '/squad_details/' + encodeURIComponent(name);
  }

  var DEFAULT_PIC = '/static/images/Default.png';

  /* MICRO is the small headshot set; the full-size one is the fallback, then
     the shared silhouette. */
  function playerImg(team, name, micro) {
    return ('/static/images/squads/' + encodeURIComponent(team) + (micro ? '-MICRO' : '') +
            '/' + encodeURIComponent(String(name).replace(/ /g, '-')) + '.png')
           /* encodeURIComponent leaves the apostrophe alone, and these URLs get
              embedded in a single-quoted string inside the onerror attribute, so
              a "D'Arcy" would otherwise close it early. */
           .replace(/'/g, '%27');
  }

  /* Walk the whole chain, not just one step: a player the feed names but the
     squad table does not have arrives here with team 'NA', so the MICRO and the
     full-size path both 404. Clearing onerror on the first miss stopped the
     silhouette from ever loading and left those as broken-image icons. */
  function playerPic(team, name, cls, micro) {
    var steps = micro !== false
      ? [playerImg(team, name, false), DEFAULT_PIC]
      : [DEFAULT_PIC];
    var onerr = "this.onerror=null;this.src='" + DEFAULT_PIC +
                "';this.classList.add('is-fallback');";
    for (var i = steps.length - 2; i >= 0; i--) {
      onerr = 'this.onerror=function(){' + onerr + "};this.src='" + steps[i] + "';";
    }
    return '<img class="' + (cls || '') + '" src="' + playerImg(team, name, micro !== false) + '" ' +
           'alt="' + esc(name) + '" loading="lazy" ' +
           'onerror="' + onerr + '">';
  }

  /* A ball's colour is decided by what it did, not by who bowled it. */
  function ballClass(score) {
    var s = String(score);
    if (/w/i.test(s) && !/wd/i.test(s)) return 'mx-ball--wicket';
    if (s.indexOf('4') > -1) return 'mx-ball--four';
    if (s.indexOf('6') > -1) return 'mx-ball--six';
    if (/wd|nb|lb|b/i.test(s)) return 'mx-ball--extra';
    if (s === '0') return 'mx-ball--dot';
    if (s === 'x') return 'mx-ball--miss';
    return '';
  }

  function ball(score) {
    var s = String(score);
    return '<span class="mx-ball ' + ballClass(s) + '">' + esc(s === '0' ? '•' : s === 'x' ? '' : s) + '</span>';
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2200);
  }

  /* Deadlines come off the feed as IST wall-clock strings, so "now" has to be
     re-expressed in IST for the comparison to hold in any timezone. */
  function istNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getTime();
  }

  /* ------------------------------------------------------------ ball maths
     What a delivery scored, what the over came to, and who faced it. The
     live and overs panels both read the same ball-by-ball feed, so this lives
     here rather than being copied into each of them. */

  function ballScore(b) {
    if (b.isWicket) {
      if (b.isByes) return (b.runsByes || 0) + 'b+W';
      if (b.isLegByes) return (b.runsLegByes || 0) + 'lb+W';
      if (b.isWide) return (b.runsWide || 0) + 'wd+W';
      if ((b.teamRuns || 0) > 0) return (b.teamRuns || 0) + 'W';
      return 'W';
    }
    if (b.isWide) return (b.runsWide || 0) > 1 ? ((b.runsWide - 1) || 0) + 'wd' : 'wd';
    if (b.isNoBall) {
      if (b.isByes) return (b.runsByes || 0) + 'b+nb';
      if (b.isLegByes) return (b.runsLegByes || 0) + 'lb+nb';
      return ((b.runsScored || 0) > 0 ? b.runsScored : '') + 'nb';
    }
    if (b.isLegByes) return ((b.runsLegByes || 0) > 0 ? b.runsLegByes : '') + 'lb';
    if (b.isByes) return ((b.runsByes || 0) > 0 ? b.runsByes : '') + 'b';
    if (b.teamRuns === 0) return '0';
    return String(b.teamRuns || 0);
  }

  /* What one delivery put on the board, extras included. The graphs panel
     walks a worm ball by ball, so the sum below is built from this rather
     than the two carrying separate copies of the same branch list. */
  function ballRuns(b) {
    if (b.isWicket) {
      if (b.isByes) return b.runsByes || 0;
      if (b.isLegByes) return b.runsLegByes || 0;
      if (b.isWide) return b.runsWide || 0;
      return (b.teamRuns || 0) > 0 ? b.teamRuns || 0 : 0;
    }
    if (b.isWide) return (b.runsWide || 0) > 1 ? (b.runsWide || 0) : 1;
    if (b.isNoBall) {
      if (b.isByes) return (b.runsByes || 0) + 1;
      if (b.isLegByes) return (b.runsLegByes || 0) + 1;
      return ((b.runsScored || 0) > 0 ? b.runsScored : 0) + (b.extras || 1);
    }
    if (b.isLegByes) return (b.runsLegByes || 0) > 0 ? b.runsLegByes : 0;
    if (b.isByes) return (b.runsByes || 0) > 0 ? b.runsByes : 0;
    return b.teamRuns || 0;
  }

  function overRuns(over) {
    return (over.balls || []).reduce(function (runs, b) { return runs + ballRuns(b); }, 0);
  }

  /* The striker is only named in the commentary line, so the list of batters
     for an over has to be read back out of the text. Newest ball first. */
  function overBatsmen(over) {
    var out = [];
    var balls = over.balls || [];
    for (var i = balls.length - 1; i >= 0; i--) {
      var c = balls[i].comments;
      if (!c || !c.length) continue;
      var msg = String(c[c.length - 1].message || '');
      var name = msg.split(' to ')[1] ? msg.split(' to ')[1].split('.')[0].trim() : '';
      if (name && out.indexOf(name) < 0) out.push(name);
    }
    return out;
  }

  /* The timeline strip counts a wide as the runs actually run, so "2wd" there
     means two byes off a wide rather than the full three-run extra. */
  function stripBallScore(score) {
    var s = String(score);
    if (s.indexOf('wd') < 0 && s.indexOf('nb') < 0) return s;
    var m = s.match(/^(\d+)([a-zA-Z]+)$/);
    if (!m) return s;
    var n = parseInt(m[1], 10) - 1;
    return n >= 1 ? n + m[2] : m[2];
  }

  /* -------------------------------------------------- shared panel pieces
     The live and scorecard panels both show player links, the awards and a
     pair of innings tabs, so those live here rather than in one of them. */

  /* A named player, linked to their profile. Players the squad table could
     not match come through as team "NA" — still shown, just not clickable. */
  function playerLink(player, markSrc) {
    var team = player.team || 'NA';
    var off = team === 'NA';
    var mark = markSrc ? '<img class="mx-plr__mark" src="' + markSrc + '" alt="">' : '';
    return '<a class="mx-plr' + (off ? ' is-off' : '') + '" href="' + playerHref(team, player.name) + '">' +
             playerPic(team, player.name, 'mx-plr__pic', true) +
             '<span class="mx-plr__name">' + esc(player.name) + mark + '</span>' +
           '</a>';
  }

  function awardCard(award, title, icon, names, colours, withStats) {
    if (!award || !award.player_name) return '';
    var name = award.player_name;
    var team = award.team_name || 'NA';
    var off = team === 'NA';
    var fn = names || {};

    var stats = withStats
      ? '<dl class="mx-potm__stats">' +
          '<div class="mx-potm__stat"><dt>Batting</dt><dd>' + esc(award.batting_stat || '—') + '</dd></div>' +
          '<div class="mx-potm__stat"><dt>Bowling</dt><dd>' + esc(award.bowling_stat || '—') + '</dd></div>' +
        '</dl>'
      : '';

    return '<div class="mx-card mx-card--award">' +
             '<div class="mx-card__head"><span class="material-icons-round">' + icon + '</span>' + esc(title) + '</div>' +
             '<div class="mx-potm">' +
               '<a class="mx-potm__pic' + (off ? ' is-off' : '') + '" href="' + playerHref(team, name) + '" ' +
                 'style="' + tint(team, colours) + '">' + playerPic(team, name, '', true) + '</a>' +
               '<div class="mx-potm__id">' +
                 '<a class="' + (off ? 'is-off' : '') + '" href="' + playerHref(team, name) + '">' +
                   '<div class="mx-potm__name">' + esc(name) + '</div></a>' +
                 '<div class="mx-potm__team">' +
                   '<img src="/static/images/squad_logos/' + encodeURIComponent(team) + '.png" alt="" ' +
                     'onerror="this.remove();">' + esc(fn[team] || team) +
                 '</div>' + stats +
               '</div>' +
             '</div>' +
           '</div>';
  }

  /* ------------------------------------------------------- innings and panes
     Four panels split the match by innings, and none of that can be read off
     the score strip: the strip carries one row per side however many innings
     the two of them played, and it is ordered by the fixture title rather than
     by who batted first. Pairing innings[i] with score_strip[i] therefore puts
     the wrong crest on an innings whenever the side named second batted first,
     and says nothing at all once there is a super over.

     So the side comes off the innings' own batting_team_id, and the strip is
     consulted for one thing only: which side is at the crease.

     Innings 3 and 4 are the first super over, 5 and 6 a second one when that is
     tied as well — both feeds number them straight on from the match proper. */

  function superOverNo(idx) {
    return idx < 2 ? 0 : Math.floor((idx - 2) / 2) + 1;
  }

  /* One pane per innings the scorecard feed carries, in the order they were
     played. `src` is that innings' ball-by-ball payload, which only the routes
     that fetch apiv2 send — the rest get null and read `inn` alone. */
  function inningsPanes(data) {
    var dt3 = data.dt3 || {};
    var tid = data.tid || {};
    var list = dt3.innings || [];
    var strip = dt3.score_strip || [];
    var src = data.inns || [];
    var playing = matchState(data) === 'live';
    var decided = superOverNo(list.length - 1);     /* super overs so far */

    var onField = null;
    strip.forEach(function (s) {
      if (s && s.currently_batting) onField = String(s.team_id);
    });

    return list.map(function (inn, idx) {
      var id = tid[inn.batting_team_id] || [];
      var abv = id[0] || '';
      var so = superOverNo(idx);
      var tag = so ? ' super over' + (decided > 1 ? ' ' + so : '') : ' innings';

      return {
        key: 'inn' + (idx + 1),
        idx: idx,
        abv: abv,
        full: id[1] || '',
        so: so,
        label: abv ? abv + tag
                   : (so ? 'Super over' + (decided > 1 ? ' ' + so : '')
                         : 'Innings ' + (idx + 1)),
        /* only the newest innings can be the one in progress, and only while
           the strip agrees that side is batting — the feed leaves
           currently_batting set after the last ball */
        live: playing && idx === list.length - 1 &&
              (!onField || String(inn.batting_team_id) === onField),
        inn: inn,
        src: src[idx] || null
      };
    });
  }

  /* One button per innings, one pane each. */
  function subtab(pane, active, colours) {
    return '<button type="button" class="mx-subtab" role="tab" data-inn="' + esc(pane.key) + '" ' +
             'aria-selected="' + (active ? 'true' : 'false') + '" style="' + tint(pane.abv, colours) + '">' +
             '<img class="mx-subtab__crest" src="/static/images/squad_logos/' + encodeURIComponent(pane.abv) +
               '.png" alt="" onerror="this.remove();">' + esc(pane.label) +
             (pane.live ? '' : '') +
           '</button>';
  }

  function wireSubtabs(root) {
    var tabs = root.querySelectorAll('.mx-subtab');
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inn = btn.getAttribute('data-inn');
        tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b === btn)); });
        root.querySelectorAll('.mx-pane').forEach(function (p) {
          p.hidden = p.getAttribute('data-inn') !== inn;
        });
      });
    });
  }

  /* Which innings should open: the one the reader was already on, else the one
     in progress, else the latest played. */
  function activePane(panes, root) {
    var open = (root || document).querySelector('.mx-subtab[aria-selected="true"]');
    var key = open ? open.getAttribute('data-inn') : null;
    return panes.filter(function (p) { return p.key === key; })[0] ||
           panes.filter(function (p) { return p.live; })[0] ||
           panes[panes.length - 1];
  }

  window.MX = {
    esc: esc, tint: tint, crest: crest, ball: ball, ballClass: ballClass,
    playerHref: playerHref, playerImg: playerImg, playerPic: playerPic,
    toast: toast, istNow: istNow,
    ballScore: ballScore, ballRuns: ballRuns, overRuns: overRuns, overBatsmen: overBatsmen,
    stripBallScore: stripBallScore,
    playerLink: playerLink, awardCard: awardCard,
    inningsPanes: inningsPanes,
    subtab: subtab, wireSubtabs: wireSubtabs, activePane: activePane
  };

  /* ==================================================================== board
     Everything on the scoreboard is derived from one payload, so the whole
     thing is rebuilt as a string and only written when it actually changed.
     ======================================================================= */

  /* "174/8 (20 ov)" -> {runs: '174/8', overs: '20'}; a super over arrives as
     a further innings joined on with "&", and a second super over as a third
     part again. All out prints as the runs alone. */
  function parseScore(raw) {
    var text = String(raw || '').replace(/^\*/, '').trim();
    if (!text) return [];
    return text.split('&').map(function (half) {
      var m = half.trim().match(/^([^(]*)(?:\(([^)]*)\))?\s*$/);
      var runs = ((m && m[1]) || half).trim().replace(/\/10$/, '');
      var overs = ((m && m[2]) || '').replace(/\s*ov\.?/i, '').trim();
      return { runs: runs, overs: overs };
    });
  }

  function scoreHTML(raw) {
    var parts = parseScore(raw);
    if (!parts.length) return '<span class="mx-wait">Yet to bat</span>';
    if (parts.length === 1) {
      return '<b>' + esc(parts[0].runs) + '</b>' +
             (parts[0].overs ? '<i>(' + esc(parts[0].overs) + ')</i>' : '');
    }
    /* The match proper stays as the quiet line it already was, with every super
       over stacked under it. They are only numbered once there is more than one
       — a single "SO 1" would read as if a second were still to come. */
    var html = '<span class="mx-side__prior">' + esc(parts[0].runs) +
                 (parts[0].overs ? ' (' + esc(parts[0].overs) + ')' : '') + '</span>';
    for (var i = 1; i < parts.length; i++) {
      html += '<span class="mx-side__so">' +
                '<span class="mx-so-tag">SO' + (parts.length > 2 ? ' ' + i : '') + '</span>' +
                '<b>' + esc(parts[i].runs) + '</b>' +
                (parts[i].overs ? '<i>(' + esc(parts[i].overs) + ')</i>' : '') +
              '</span>';
    }
    return html;
  }

  /* The first number in "Run Rate: 8.70" — the feed has shipped a few
     different labels for this field over the years. */
  function rate(v) {
    var hit = String(v === undefined || v === null ? '' : v).match(/[\d.]+/g);
    return hit && hit.length ? hit[hit.length - 1] : null;
  }

  function requiredRate(strip, info) {
    var given = rate(strip && strip.required_run_rate);
    if (given) return given;
    /* "need 45 runs in 30 balls" / "... in 5 overs" — both forms show up */
    var m = String(info || '').match(/need\s+(\d+)\s+runs?\s+(?:in|from)\s+(\d+(?:\.\d+)?)\s*(balls?|overs?)/i);
    if (!m) return null;
    var overs = /ball/i.test(m[3]) ? (+m[2]) / 6 : (+m[2]);
    return overs > 0 ? (+m[1] / overs).toFixed(2) : null;
  }

  function sidesOf(data) {
    var tid = data.tid || {};
    return (data.dt3.score_strip || []).slice(0, 2).map(function (s) {
      var id = tid[s.team_id] || [];
      return {
        abv: id[0] || s.short_name || '',
        full: id[1] || s.name || '',
        score: s.score || '',
        batting: !!s.currently_batting,
        strip: s
      };
    });
  }

  function winnerOf(info, sides) {
    var low = String(info || '').toLowerCase();
    var at = low.indexOf(' won');
    if (at < 0) return null;
    var head = low.slice(0, at);
    for (var i = 0; i < sides.length; i++) {
      var s = sides[i];
      if ((s.full && head.indexOf(s.full.toLowerCase()) > -1) ||
          (s.abv && head.indexOf(s.abv.toLowerCase()) > -1)) return s.abv;
    }
    return null;
  }

  function matchState(data) {
    var info = String(data.dt3.info || '');
    if (!info) return data.dt3.match_status === 'post' ? 'done' : 'pre';
    if (ENDED.test(info)) return 'done';
    return 'live';
  }

  function stateChip(state, info) {
    if (state === 'live') return { cls: 'mx-state--live', text: 'Live' };
    if (state === 'done') {
      return /abandoned|no result/i.test(info || '')
        ? { cls: 'mx-state--off', text: 'No result' }
        : { cls: 'mx-state--done', text: 'Result' };
    }
    return { cls: 'mx-state--soon', text: 'Upcoming' };
  }

  function boardHTML(data) {
    var dt3 = data.dt3 || {};
    var tid = data.tid || {};
    var info = String(dt3.info || '');
    var state = matchState(data);
    var sides = sidesOf(data);
    var winner = state === 'done' ? winnerOf(info, sides) : null;
    var colours = data.clr2 && typeof data.clr2 === 'object' ? data.clr2 : data.clr;
    var html = '';

    /* --- what the toss decided (the state pill lives up in the masthead) - */
    if (dt3.toss_won_by && tid[dt3.toss_won_by]) {
      html += '<div class="mx-board__top">' +
                '<span class="mx-board__toss">' +
                  '<span class="material-icons-round">toll</span>' +
                  '<b>' + esc(tid[dt3.toss_won_by][0]) + '</b> won the toss' +
                  (dt3.toss_decision ? ' and chose to ' + esc(dt3.toss_decision) : '') +
                '</span>' +
              '</div>';
    }

    /* --- the two innings lines ------------------------------------------ */
    html += '<div class="mx-sides">';
    sides.forEach(function (s) {
      var cls = '';
      if (state === 'live' && s.batting) cls = 'is-batting';
      else if (winner && s.abv === winner) cls = 'is-won';
      else if (winner) cls = 'is-lost';

      var stack = String(s.score || '').indexOf('&') > -1 ? ' mx-side__score--stack' : '';

      html += '<div class="mx-side ' + cls + '" data-team="' + esc(s.abv) + '">' +
                crest(s.abv, colours, '') +
                '<span class="mx-side__id">' +
                  '<span class="mx-side__abv">' + esc(s.abv) + '</span>' +
                  '<span class="mx-side__full">' + esc(s.full) + '</span>' +
                '</span>' +
                (state === 'live' && s.batting
                  ? '<span class="mx-side__bat"><span class="material-icons-round" style="font-size:13px">sports_cricket</span>Batting</span>'
                  : '') +
                '<span class="mx-side__score' + stack + '" data-score="' + esc(s.abv) + '">' +
                  scoreHTML(s.score) +
                '</span>' +
              '</div>';
    });
    html += '</div>';

    /* --- status line ----------------------------------------------------- */
    if (info) {
      var tone = state === 'live' ? 'mx-board__info--live'
               : (/abandoned|no result/i.test(info) ? 'mx-board__info--na' : 'mx-board__info--done');
      html += '<p class="mx-board__info ' + tone + '">' + esc(info) + '</p>';
    }

    /* --- run-rate tiles, only while there is a game to describe ----------
       All four read the innings in progress, which the strip cannot name: it
       is the last innings of inningsPanes(), and in a super over that is the
       third or the fourth. A chase is any even-numbered innings — the 2nd of
       the match, or the second half of a super over — and what it is chasing
       is the innings right before it. */
    if (state === 'live') {
      var panes = inningsPanes(data);
      var now = panes.filter(function (p) { return p.live; })[0] || panes[panes.length - 1];
      var target = now && now.idx % 2 === 1 ? panes[now.idx - 1] : null;
      var pship = now ? now.inn.current_partnership : null;
      var batting = now ? sides.filter(function (s) {
        return s.strip && String(s.strip.team_id) === String(now.inn.batting_team_id);
      })[0] : null;
      var tiles = '';

      if (target) {
        var chased = parseInt(String(target.inn.runs), 10);
        if (!isNaN(chased)) tiles += tile('Target', chased + 1, '', 'mx-tile--target');
      }

      var crr = batting ? rate(batting.strip.run_rate) : null;
      if (crr) tiles += tile('CRR', crr);

      if (target) {
        var rrr = requiredRate(batting && batting.strip, info) ||
                  requiredRate(sides[0] && sides[0].strip, info) ||
                  requiredRate(sides[1] && sides[1].strip, info);
        if (rrr) tiles += tile('RRR', rrr, '', 'mx-tile--rrr');
      }

      if (pship) tiles += tile('Partnership', pship.runs, '(' + pship.balls + ')');

      if (tiles) html += '<dl class="mx-tiles">' + tiles + '</dl>';
    }

    /* --- countdown, while the start time is still ahead of us ------------ */
    var start = data.dttm ? new Date(data.dttm) : null;
    var now = data.cd ? new Date(data.cd) : null;
    if (state === 'pre' && start && now && start > now) {
      html += '<div class="mx-clock" data-deadline="' + esc(data.dttm) + '">' +
                clockUnit('d', 'Days') + clockUnit('h', 'Hrs') +
                clockUnit('m', 'Min') + clockUnit('s', 'Sec') +
              '</div>';
    }

    return html;
  }

  function tile(label, value, sub, cls) {
    return '<div class="mx-tile ' + (cls || '') + '">' +
             '<dt>' + esc(label) + '</dt>' +
             '<dd>' + esc(value) + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</dd>' +
           '</div>';
  }

  function clockUnit(key, label) {
    return '<div class="mx-clock__unit">' +
             '<span class="mx-clock__n" data-u="' + key + '">0</span>' +
             '<span class="mx-clock__u">' + label + '</span>' +
           '</div>';
  }

  /* The status pill sits in the masthead, outside the board's own markup, so
     it is kept in step here rather than rebuilt with the score. */
  function renderState(data) {
    var el = document.getElementById('mxState');
    if (!el) return;
    var chip = stateChip(matchState(data), data.dt3.info);
    var html = '<span class="mx-state__dot"></span>' + chip.text;
    el.className = 'mx-state ' + chip.cls;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderBoard(data) {
    if (!boardEl || !data || !data.dt3) return;

    renderState(data);

    var html = boardHTML(data);
    if (boardEl.getAttribute('data-sig') === html) return;   /* nothing moved */

    /* remember what each side showed, so only a real change flashes */
    var before = {};
    boardEl.querySelectorAll('[data-score]').forEach(function (el) {
      before[el.getAttribute('data-score')] = el.textContent.trim();
    });
    var first = !boardEl.getAttribute('data-sig');

    boardEl.setAttribute('data-sig', html);
    boardEl.innerHTML = html;

    if (!first) {
      boardEl.querySelectorAll('[data-score]').forEach(function (el) {
        var key = el.getAttribute('data-score');
        if (before[key] === undefined || before[key] === el.textContent.trim()) return;
        var n = el.querySelector('b');
        if (!n) return;
        n.classList.remove('is-bump');
        void n.offsetWidth;                                  /* restart it */
        n.classList.add('is-bump');
      });
    }

    startClock();
    syncTitle(data);
  }

  /* The browser tab is a scoreboard too when the page is in the background. */
  function syncTitle(data) {
    var sides = sidesOf(data);
    var batting = sides.filter(function (s) { return s.batting; })[0];
    /* the last part, not the first: in a super over the live score is the
       decider rather than the innings it was tied in */
    var parts = batting && batting.score ? parseScore(batting.score) : [];
    var p = parts[parts.length - 1] || null;
    if (matchState(data) === 'live' && p) {
      document.title = batting.abv + ' ' + p.runs + (p.overs ? ' (' + p.overs + ')' : '') +
                       ' · ' + sides.map(function (s) { return s.abv; }).join(' v ');
    } else {
      document.title = baseTitle;
    }
  }

  /* ------------------------------------------------------------- countdown */

  function startClock() {
    clearInterval(clockTimer);
    var el = boardEl.querySelector('.mx-clock');
    if (!el) return;

    var end = new Date(el.getAttribute('data-deadline')).getTime();
    var out = {
      d: el.querySelector('[data-u="d"]'), h: el.querySelector('[data-u="h"]'),
      m: el.querySelector('[data-u="m"]'), s: el.querySelector('[data-u="s"]')
    };
    if (!out.d || !out.h || !out.m || !out.s) return;

    function tick() {
      var t = end - istNow();
      if (t < 0) t = 0;
      out.d.textContent = Math.floor(t / 86400000);
      out.h.textContent = Math.floor((t % 86400000) / 3600000);
      out.m.textContent = Math.floor((t % 3600000) / 60000);
      out.s.textContent = Math.floor((t % 60000) / 1000);
      el.classList.toggle('is-soon', t > 0 && t < 3600000);
      el.classList.toggle('is-over', t === 0);
      /* the toss is usually up within a few minutes of the start time, so ask
         the feed once the clock runs out rather than leaving a dead page */
      if (t === 0 && !startFired) {
        startFired = true;
        load(currentTab, { silent: true });
      }
    }

    tick();
    clockTimer = setInterval(tick, 1000);
  }

  /* ==================================================================== tabs */

  function panelSkeleton() {
    panelEl.innerHTML =
      '<div class="mx-card mx-skel--pad">' +
        '<div class="mx-skel mx-skel--row"></div>' +
        '<div class="mx-skel mx-skel--line" style="width: 70%"></div>' +
        '<div class="mx-skel mx-skel--line" style="width: 45%"></div>' +
        '<div class="mx-skel mx-skel--row"></div>' +
      '</div>';
  }

  function panelError(msg, retry) {
    panelEl.innerHTML =
      '<div class="mx-empty mx-empty--error">' +
        '<span class="material-icons-round">cloud_off</span>' +
        '<b>' + esc(msg || 'Could not load this tab') + '</b>' +
        '<p>The score feed did not answer. Your connection may be offline.</p>' +
        (retry === false ? '' : '<button type="button" class="mx-btn" id="mxRetry">' +
          '<span class="material-icons-round">refresh</span>Try again</button>') +
      '</div>';
    var btn = document.getElementById('mxRetry');
    if (btn) btn.addEventListener('click', function () { load(currentTab); });
  }

  function syncTabs() {
    barEl.querySelectorAll('.mx-tab').forEach(function (btn) {
      var on = btn.getAttribute('data-tab') === currentTab;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      if (!on) return;
      panelEl.setAttribute('aria-labelledby', btn.id);
      /* the strip scrolls on a narrow phone, so the tab that is on has to
         bring itself into view — otherwise nothing on screen says which */
      if (btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  /* The Live tab is called Commentary once the match is done, and carries a
     pulse while it is on. */
  function syncLiveTab(state) {
    var btn = barEl.querySelector('.mx-tab[data-tab="liveScore"]');
    if (!btn) return;
    var label = state === 'done' ? 'Commentary' : 'Live';
    var dot = state === 'live' ? '<span class="mx-tab__dot"></span>' : '';
    var html = dot + label;
    if (btn.innerHTML !== html) btn.innerHTML = html;
  }

  function setTab(tab, opts) {
    if (TABS.indexOf(tab) < 0) tab = DEFAULT_TAB;
    currentTab = tab;
    syncTabs();

    try {
      var url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* older browsers just keep the URL they had */ }

    panelSkeleton();
    load(tab, opts);
  }

  /* Is there something worth keeping on screen, or just a skeleton? */
  function panelHasContent() {
    return !!panelEl.children.length &&
           !panelEl.querySelector('.mx-skel') &&
           !panelEl.querySelector('.mx-empty--error');
  }

  /* Panels live in their own files; load once, then call on every refresh. */
  function renderPanel(tab, data, silent) {
    var spec = PANEL[tab];
    if (!spec) return panelError('Unknown tab');

    if (typeof window[spec.fn] === 'function') {
      try {
        window[spec.fn](data);
      } catch (err) {
        if (window.console) console.error(err);
        /* a background refresh that trips over an odd payload leaves the last
           good panel up rather than blanking a working page */
        if (!silent || !panelHasContent()) panelError('This tab could not be drawn');
      }
      return;
    }

    var script = document.createElement('script');
    script.src = '/static/js/' + spec.file;
    script.onload = function () {
      if (typeof window[spec.fn] === 'function') renderPanel(tab, data, silent);
      else panelError('This tab could not be drawn');
    };
    script.onerror = function () { panelError('This tab could not be loaded'); };
    document.body.appendChild(script);
  }

  /* ================================================================ polling */

  function load(tab, opts) {
    opts = opts || {};
    /* background polls never stack; a tab switch always wins and the token
       below makes sure the answer to an abandoned request is dropped */
    if (opts.silent && pending) return;
    var token = ++reqToken;
    pending++;
    if (!opts.silent && toggleEl) toggleEl.classList.add('is-spinning');

    fetch('/api/match-' + encodeURIComponent(window.match) + '/' + encodeURIComponent(tab),
          { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (token !== reqToken) return;              /* a newer request won */
        if (!data || !data.dt3) throw new Error('empty payload');
        lastAt = Date.now();
        stale = false;

        var state = matchState(data);
        liveNow = state === 'live';

        /* Nothing is moving yet, but a match about to start is worth keeping
           an eye on — the toss and the XI land before the first ball. */
        var start = data.dttm ? new Date(data.dttm).getTime() : 0;
        var now = data.cd ? new Date(data.cd).getTime() : 0;
        nearStart = !!(state === 'pre' && start && now && (start - now) < 2700000);

        renderBoard(data);
        syncLiveTab(state);
        if (tab === currentTab) renderPanel(tab, data, opts.silent);
        syncRefresh();
        schedule();
      })
      .catch(function (err) {
        if (token !== reqToken) return;
        stale = true;
        syncRefresh();
        /* a failed background poll keeps whatever is on screen */
        if (!opts.silent) panelError('Could not load this tab');
        schedule();
        if (window.console) console.warn('match feed:', err);
      })
      .then(function () {
        pending = Math.max(0, pending - 1);
        if (toggleEl) toggleEl.classList.remove('is-spinning');
      });
  }

  function schedule() {
    clearTimeout(pollTimer);
    if (paused) return;
    var wait = liveNow ? POLL_MS : (nearStart ? WARMUP_MS : 0);
    if (!wait) return;                             /* finished or far off */
    pollTimer = setTimeout(function () {
      if (document.hidden) return schedule();      /* idle while backgrounded */
      load(currentTab, { silent: true });
    }, wait);
  }

  function ageText() {
    if (stale) return 'reconnecting…';
    if (!lastAt) return '';
    var s = Math.round((Date.now() - lastAt) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    return Math.floor(s / 60) + 'm ago';
  }

  function syncRefresh() {
    if (!refreshEl) return;
    refreshEl.hidden = !(liveNow || nearStart);
    if (refreshEl.hidden) {
      clearInterval(ageTimer);
      ageTimer = null;
      return;
    }
    if (ageEl) ageEl.textContent = ageText();
    if (!ageTimer) {
      ageTimer = setInterval(function () {
        if (ageEl) ageEl.textContent = ageText();
      }, 1000);
    }
  }

  /* ------------------------------------------------------------------ wiring */

  barEl.querySelectorAll('.mx-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      if (tab === currentTab) return;
      setTab(tab);
      /* on a phone the strip is sticky — keep the panel top in view */
      var y = barEl.getBoundingClientRect().top + window.pageYOffset -
              (parseInt(getComputedStyle(document.documentElement)
                .getPropertyValue('--mx-stick'), 10) || 80);
      if (window.pageYOffset > y) window.scrollTo({ top: y, behavior: 'smooth' });
    });
  });

  /* Left / right walk the tab strip, the way a tablist is expected to work. */
  barEl.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var at = TABS.indexOf(currentTab);
    var next = TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next);
    var btn = barEl.querySelector('.mx-tab[data-tab="' + next + '"]');
    if (btn) btn.focus();
    e.preventDefault();
  });

  if (toggleEl) {
    toggleEl.addEventListener('click', function () {
      paused = !paused;
      toggleEl.setAttribute('aria-pressed', String(!paused));
      toggleEl.title = paused ? 'Resume auto-refresh' : 'Pause auto-refresh';
      toggleEl.innerHTML = '<span class="material-icons-round">' +
                           (paused ? 'play_arrow' : 'pause') + '</span>';
      if (paused) {
        clearTimeout(pollTimer);
        toast('Auto-refresh paused');
      } else {
        load(currentTab, { silent: true });
        toast('Auto-refresh on');
      }
    });
  }

  var shareBtn = document.getElementById('mxShare');
  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var url = window.location.href;
      var title = shareBtn.getAttribute('data-title') || document.title;
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () { /* dismissed */ });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          shareBtn.classList.add('is-done');
          toast('Match link copied');
        });
      } else {
        window.prompt('Copy this link', url);
      }
    });
  }

  /* Catch up the moment the tab comes back to the foreground. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || paused || !(liveNow || nearStart)) return;
    load(currentTab, { silent: true });
  });

  /* Back to top, and elevation on the sticky strip once it bites. */
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
      toTop.classList.toggle('is-on', window.pageYOffset > 500);
      barEl.classList.toggle('is-stuck',
        barEl.getBoundingClientRect().top <= (parseFloat(getComputedStyle(barEl).top) || 80) + 1);
      ticking = false;
    });
  }, { passive: true });

  /* The navbar is fixed and its height moves with the viewport, so the sticky
     strip is positioned from a measurement rather than a constant. */
  function syncStick() {
    var nav = document.querySelector('nav.navbar');
    var h = nav ? nav.getBoundingClientRect().height : 72;
    document.documentElement.style.setProperty('--mx-stick', (h + 8) + 'px');
  }
  syncStick();
  window.addEventListener('resize', syncStick);

  /* -------------------------------------------------------------- start up */

  function initialTab() {
    var asked = null;
    try { asked = new URLSearchParams(window.location.search).get('tab'); } catch (e) { /* ignore */ }
    return TABS.indexOf(asked) > -1 ? asked : DEFAULT_TAB;
  }

  setTab(initialTab());
})();

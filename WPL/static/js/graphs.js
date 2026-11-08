/* ==========================================================================
   WPL 2027 · Match centre — Graphs panel
   --------------------------------------------------------------------------
   Four reads of the same innings the Overs tab lists: a Manhattan of runs per
   over, a worm with both innings laid over each other, the same worm divided
   by the overs it took (the run rate), and the phase breakdown. Everything is
   derived from the ball-by-ball feed already on the payload —
   /api/match-<no>/Graphs is the overs route under a second name, so the two
   tabs can never disagree about a score.

   The charts are inline SVG built against the container's real pixel width and
   redrawn on resize, rather than one drawing stretched to fit by a viewBox.
   Nothing is scaled: type stays 9.5–11px at every width and it is the label
   density that drops as the viewport narrows.

   A series is painted in the batting side's own colours — nothing is invented.
   ptclr, clr and sqclr all come down on the payload, and teamPair() picks from
   them: the canonical one when it works, one of that team's others when it
   does not. See the colour block below.

   Helpers live in the closure rather than on window: every panel script shares
   one global scope, and names like scale() or tag() would not stay unique.
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------------------------------------- chart chrome
     SURFACE is the card's own background once its white wash sits over the
     page gradient. Gaps and rings are "cut" out of it, and the series band
     below was picked against it, so the two have to move together. */

  var SURFACE = '#381a2b';
  var GRID = 'rgba(255, 255, 255, 0.085)';
  var AXIS = 'rgba(255, 255, 255, 0.18)';
  var INK2 = '#deb6ce';
  var INK3 = '#b587a2';

  /* ===================================================================== colour
     Every hex a chart paints comes out of the team tables in main.py — ptclr
     (the one canonical colour per side), clr (the c1/c2/c3 set) and sqclr (the
     crest gradient). Nothing here mixes a new colour; it only decides which of
     a side's own colours to use, because two of them cause trouble on a chart
     that the crests and gradients elsewhere never hit:

       · the near-blacks. RCBW's #20285d and its #444444 are barely off this
         surface — a line in them is not dim, it is invisible.
       · the shared blues. DCW and MIW both lead with one, so that matchup
         would otherwise be two lines in what is, to the eye, one colour.

     So each side's colours are ranked (stay near the canonical hue, but not at
     the cost of a mark nobody can see) and the pair is chosen off those two
     lists. Most matchups just get both canonical colours.
     ====================================================================== */

  function srgb2lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lin2srgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

  /* #rgb, #rrggbb, and the hsl() forms the colour table also carries */
  function toRGB(value) {
    var s = String(value || '').trim();
    var hsl = s.match(/^hsl\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%\s*\)$/i);
    if (hsl) return hsl2rgb(+hsl[1], +hsl[2] / 100, +hsl[3] / 100);
    var h = s.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16) / 255; });
  }

  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
          : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return t.map(function (v) { return v + m; });
  }

  function toHex(rgb) {
    return '#' + rgb.map(function (v) {
      return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    }).join('');
  }

  function oklab(rgb) {
    var r = srgb2lin(rgb[0]), g = srgb2lin(rgb[1]), b = srgb2lin(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }

  function hue(value) { var lab = oklab(toRGB(value)); return Math.atan2(lab[2], lab[1]); }
  function chroma(value) { var lab = oklab(toRGB(value)); return Math.hypot(lab[1], lab[2]); }

  function contrast(a, b) {
    var x = luminance(a) + 0.05, y = luminance(b) + 0.05;
    return x > y ? x / y : y / x;
  }

  function luminance(value) {
    var rgb = toRGB(value) || [0, 0, 0];
    return 0.2126 * srgb2lin(rgb[0]) + 0.7152 * srgb2lin(rgb[1]) + 0.0722 * srgb2lin(rgb[2]);
  }

  /* How much a colour has to be argued down for being hard to see on this
     surface. 3:1 is the non-text contrast minimum; under 2:1 a mark is gone. */
  function dimness(value) {
    var c = contrast(value, SURFACE);
    return c >= 3 ? 0 : c >= 2.5 ? 0.5 : c >= 2 ? 0.9 : 2.2;
  }

  /* --- a side's own colours, best first ----------------------------------- */

  /* Everything main.py holds for this team, canonical first and de-duplicated.
     A guest side missing from all three tables falls back to the page accent —
     there is no team colour to honour in that case. */
  function palette(team, tables) {
    var out = [];
    function add(value) {
      var rgb = toRGB(value);
      if (!rgb) return;
      var h = toHex(rgb);
      if (out.indexOf(h) < 0) out.push(h);
    }
    add((tables.pt || {})[team]);
    var set = (tables.full || {})[team] || {};
    add(set.c1); add(set.c2); add(set.c3);
    var sq = (tables.squad || {})[team] || {};
    add(sq.c1); add(sq.c2);
    if (!out.length) add('#29c5e8');
    return out;
  }

  /* Ranked: hold the canonical hue where we can, give it up where the colour
     would not survive the background. Position in the table breaks ties, so a
     side whose colours are all fine keeps main.py's own order. */
  function ranked(team, tables) {
    var all = palette(team, tables);
    var anchor = all.filter(function (h) { return chroma(h) > 0.03; })[0] || all[0];
    return all
      .map(function (h, i) {
        var gap = Math.abs(hue(h) - hue(anchor));
        if (gap > Math.PI) gap = 2 * Math.PI - gap;
        return { hex: h, cost: (gap / Math.PI) * 0.6 + dimness(h) + i * 0.05 };
      })
      .sort(function (a, b) { return a.cost - b.cost; })
      .map(function (o) { return o.hex; });
  }

  /* --- how far apart two marks actually look ----------------------------- */

  /* Machado, Oliveira & Fernandes (2009), severity 1.0, in linear RGB. */
  var CVD = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]
  };

  function simulate(value, kind) {
    var lin = toRGB(value).map(srgb2lin);
    return toHex(CVD[kind].map(function (row) {
      return lin2srgb(Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
    }));
  }

  function apart(a, b) {
    var x = oklab(toRGB(a)), y = oklab(toRGB(b));
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100;
  }

  function apartCVD(a, b) {
    return Math.min(apart(simulate(a, 'protan'), simulate(b, 'protan')),
                    apart(simulate(a, 'deutan'), simulate(b, 'deutan')));
  }

  /* One side on its own: its best colour, full stop. */
  function soloColour(team, tables) { return ranked(team, tables)[0]; }

  /* Two sides. The cheapest pair of *real* team colours that a reader can tell
     apart — usually both canonical, and never more than a step or two down
     either list. The gates: 15 apart on unsimulated vision is hard, because
     below that even full-colour readers cannot separate the pair; 6 under
     protan/deutan is the floor, and that floor is only spendable because every
     chart here also carries crests, direct labels and a table view.

     If no pair clears — two sides with one usable colour each, both the same
     red — the furthest-apart pair wins and the legend does the rest. */
  function teamPair(a, b, tables) {
    var A = ranked(a, tables), B = ranked(b, tables);
    var best = null;
    var i, j, gap, cost;

    for (i = 0; i < A.length; i++) {
      for (j = 0; j < B.length; j++) {
        if (apart(A[i], B[j]) < 15 || apartCVD(A[i], B[j]) < 6) continue;
        /* a step down the list is cheaper than a mark nobody can see */
        cost = i + j + dimness(A[i]) + dimness(B[j]);
        if (!best || cost < best.cost) best = { cost: cost, pair: [A[i], B[j]] };
      }
    }
    if (best) return best.pair;

    for (i = 0; i < A.length; i++) {
      for (j = 0; j < B.length; j++) {
        gap = apart(A[i], B[j]);
        if (!best || gap > best.cost) best = { cost: gap, pair: [A[i], B[j]] };
      }
    }
    return best ? best.pair : [A[0], B[0]];
  }

  /* Text set inside a filled mark takes whichever side of the fill clears. */
  function inkOn(fill) {
    return luminance(fill) > 0.34 ? '#1f0615' : '#ffffff';
  }

  /* ====================================================================== model
     One innings folded into the three shapes the charts need: a row per over,
     a point per delivery, and every wicket with the score it fell at.
     ======================================================================= */

  /* The feed hands an over's deliveries back newest first. */
  function chrono(over) { return (over.balls || []).slice().reverse(); }

  function innModel(src, abv, full) {
    var MX = window.MX;
    var inn = src && src.inning;
    if (!inn || !Array.isArray(inn.overs) || !inn.overs.length) return null;

    var overs = inn.overs
      .filter(function (o) { return o && o.overNumber > 0 && (o.balls || []).length; })
      .slice()
      .sort(function (a, b) { return a.overNumber - b.overNumber; });
    if (!overs.length) return null;

    var rows = [];                        /* one per over */
    var trail = [{ x: 0, y: 0 }];         /* cumulative runs, a point per delivery */
    var rates = [];                       /* cumulative run rate, a point per over */
    var falls = [];                       /* every wicket, in order */
    var byOver = [{ runs: 0, wkts: 0, rate: 0 }];   /* what the crosshair reads */
    var running = 0, down = 0;

    overs.forEach(function (o) {
      var balls = chrono(o);
      var runs = typeof o.totalRuns === 'number' ? o.totalRuns : MX.overRuns(o);
      /* the feed's own running total is authoritative; the per-ball walk only
         has to get from the start of the over to it */
      var end = typeof o.totalInningRuns === 'number' ? o.totalInningRuns : running + runs;
      var at = end - runs;
      var legal = 0, wkts = 0;

      balls.forEach(function (b) {
        at += MX.ballRuns(b);
        if (!b.isWide && !b.isNoBall) legal++;
        var x = (o.overNumber - 1) + Math.min(legal, 6) / 6;
        trail.push({ x: x, y: at });
        if (b.isWicket) {
          wkts++;
          falls.push({ x: x, y: at, over: o.overNumber, down: down + wkts });
        }
      });

      trail[trail.length - 1].y = end;     /* pin the over back onto the feed */
      running = end;
      down += wkts;

      /* Overs actually faced, not the over number: the last over of a live
         innings is part-bowled, and dividing by a whole over there would
         understate the rate by up to a sixth. */
      var faced = trail[trail.length - 1].x;
      var rate = faced > 0 ? end / faced : 0;

      rows.push({ over: o.overNumber, runs: runs, wkts: wkts, end: end, down: down,
                  faced: faced, rate: rate });
      rates.push({ x: faced, y: rate });
      byOver[o.overNumber] = { runs: end, wkts: down, rate: rate };
    });

    /* a hole in the feed must not read as an over where the score went to zero */
    for (var i = 1; i < byOver.length; i++) if (!byOver[i]) byOver[i] = byOver[i - 1];

    return {
      abv: abv, full: full || abv,
      rows: rows, trail: trail, rates: rates, falls: falls, byOver: byOver,
      total: running, wkts: down,
      peakRate: rates.reduce(function (a, p) { return Math.max(a, p.y); }, 0),
      lastOver: rows[rows.length - 1].over,
      lastX: trail[trail.length - 1].x
    };
  }

  function runRate(m) { return m.lastX > 0 ? m.total / m.lastX : 0; }

  /* "9" for nine complete overs, "9.3" three balls into the tenth. */
  function oversText(x) {
    var whole = Math.floor(x + 1e-9);
    var balls = Math.round((x - whole) * 6);
    return balls ? whole + '.' + balls : String(whole);
  }

  function score(m) { return m.total + '-' + m.wkts; }

  /* Powerplay, middle, death. The last block is named for the over the innings
     actually reached, so a side bowled out in the 18th reads "15–18". */
  function phases(m) {
    var last = m.lastOver;
    return [[1, 6], [7, 14], [15, Math.max(15, last)]].map(function (c) {
      var from = c[0], to = Math.min(c[1], last);
      if (to < from) return null;
      var rows = m.rows.filter(function (r) { return r.over >= from && r.over <= to; });
      if (!rows.length) return null;
      var runs = rows.reduce(function (n, r) { return n + r.runs; }, 0);
      return {
        from: from, to: to,
        label: from + '–' + to,
        runs: runs,
        wkts: rows.reduce(function (n, r) { return n + r.wkts; }, 0),
        rate: (runs / rows.length).toFixed(2),
        falls: m.falls.filter(function (f) { return f.x > from - 1 && f.x <= to; })
      };
    }).filter(Boolean);
  }

  /* ==================================================================== drawing
     Geometry is in real pixels — the drawing is rebuilt at the container's
     width rather than stretched to it.
     ===================================================================== */

  function metrics(w) {
    if (w < 400) return { h: 202, font: 9.5, padL: 25, bar: 16, dot: 3.6, wkt: 5.5, tick: 30 };
    if (w < 600) return { h: 226, font: 10, padL: 28, bar: 20, dot: 4, wkt: 6, tick: 34 };
    if (w < 900) return { h: 262, font: 10.5, padL: 31, bar: 22, dot: 4.5, wkt: 6.5, tick: 38 };
    return { h: 302, font: 11, padL: 35, bar: 24, dot: 5, wkt: 7, tick: 42 };
  }

  /* Axis ticks land on numbers a reader would have picked. */
  function ticksTo(max, want) {
    if (!(max > 0)) return { max: 1, ticks: [0, 1] };
    var mag = Math.pow(10, Math.floor(Math.log10(max / want)));
    var step = 10 * mag;
    [1, 2, 2.5, 5].some(function (mult) {
      if (mult * mag >= max / want) { step = mult * mag; return true; }
      return false;
    });
    var top = Math.ceil(max / step) * step;
    var out = [];
    for (var v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
    return { max: top, ticks: out };
  }

  function n2(v) { return Math.round(v * 100) / 100; }

  function tag(name, attrs, inner) {
    var out = '<' + name;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v !== null && v !== undefined && v !== false && v !== '') out += ' ' + k + '="' + v + '"';
    });
    return inner === undefined ? out + '/>' : out + '>' + inner + '</' + name + '>';
  }

  function label(x, y, str, opts) {
    opts = opts || {};
    return tag('text', {
      x: n2(x), y: n2(y),
      'text-anchor': opts.anchor || 'middle',
      'font-size': opts.size,
      'font-weight': opts.weight || 600,
      fill: opts.fill || INK3
    }, window.MX.esc(str));
  }

  /* A column: 4px rounded cap, square where it meets the baseline. */
  function column(cx, w, top, base) {
    var r = Math.min(4, w / 2, Math.max(0, base - top));
    var l = cx - w / 2, rt = cx + w / 2;
    return 'M' + n2(l) + ' ' + n2(base) +
           'L' + n2(l) + ' ' + n2(top + r) +
           'Q' + n2(l) + ' ' + n2(top) + ' ' + n2(l + r) + ' ' + n2(top) +
           'L' + n2(rt - r) + ' ' + n2(top) +
           'Q' + n2(rt) + ' ' + n2(top) + ' ' + n2(rt) + ' ' + n2(top + r) +
           'L' + n2(rt) + ' ' + n2(base) + 'Z';
  }

  /* A dot that stays legible wherever it lands: the ring is the surface
     colour, so the mark is cut out of whatever it is sitting on. */
  function dot(cx, cy, r, fill) {
    return tag('circle', { cx: n2(cx), cy: n2(cy), r: n2(r), fill: fill,
                           stroke: SURFACE, 'stroke-width': 2 });
  }

  function rule(x1, y1, x2, y2, stroke) {
    return tag('line', { x1: n2(x1), y1: n2(y1), x2: n2(x2), y2: n2(y2),
                         stroke: stroke || GRID, 'stroke-width': 1,
                         'shape-rendering': 'crispEdges' });
  }

  function svgOpen(w, h, aria) {
    return '<svg class="mxg-svg" width="' + n2(w) + '" height="' + n2(h) + '" ' +
           'viewBox="0 0 ' + n2(w) + ' ' + n2(h) + '" role="img" ' +
           'aria-label="' + window.MX.esc(aria) + '">';
  }

  /* The axis furniture both plots share: the horizontal grid, its value
     labels, and the "Runs" / "Ov" captions. "Ov" rides the same baseline as
     the over numbers so the card never has to grow a second label row. */
  function frame(g, M, scale, plot, axis) {
    var out = '';
    scale.ticks.forEach(function (v) {
      out += rule(g.padL, plot.y(v), g.padL + g.plotW, plot.y(v), v === 0 ? AXIS : GRID);
      out += label(g.padL - 7, plot.y(v) + M.font * 0.36, String(v), { anchor: 'end', size: M.font });
    });
    out += label(g.padL - 7, M.font + 1, axis || 'Runs', { anchor: 'start', size: M.font });
    out += label(g.w - 2, g.padT + g.plotH + M.font + 9, 'Ov',
                 { anchor: 'end', size: M.font * 0.92 });
    return out;
  }

  /* ------------------------------------------------------------- Manhattan */

  function manhattan(m, colour, w, M) {
    /* padR clears the "Ov" caption, which rides the over-number baseline */
    var padL = M.padL, padR = 30;
    var padT = Math.round(2 * M.wkt + M.font + 10);
    var padB = Math.round(M.font + 16);
    var plotW = Math.max(60, w - padL - padR);
    var plotH = Math.max(60, M.h - padT - padB);
    var n = m.rows.length;

    var peak = m.rows.reduce(function (a, r) { return Math.max(a, r.runs); }, 0);
    var scale = ticksTo(Math.max(peak, 4), 5);
    var slot = plotW / Math.max(n, 1);
    var barW = Math.min(M.bar, Math.max(3, slot - 2));       /* leaves the 2px gap */
    var y = function (v) { return padT + plotH - (v / scale.max) * plotH; };
    var cx = function (i) { return padL + slot * i + slot / 2; };
    var geo = { padL: padL, padT: padT, plotW: plotW, plotH: plotH, w: w,
                slot: slot, barW: barW, n: n };

    var g = frame(geo, M, scale, { y: y });

    /* one series, so one colour — length already carries how big the over was */
    var bars = '', pips = '';
    m.rows.forEach(function (r, i) {
      if (r.runs > 0) bars += tag('path', { d: column(cx(i), barW, y(r.runs), y(0)), fill: colour });
      if (!r.wkts) return;
      var cy = Math.max(M.wkt + 2, y(r.runs) - M.wkt - 5);
      pips += dot(cx(i), cy, M.wkt, colour);
      if (r.wkts > 1) {
        pips += label(cx(i), cy + M.wkt * 0.38, String(r.wkts),
                      { size: M.wkt * 1.2, weight: 800, fill: inkOn(colour) });
      }
    });
    g += bars + pips;

    /* one direct label — the over that broke the innings open. It goes on the
       cap, or just inside it when a wicket pip already owns that airspace and
       the bar is deep and wide enough to hold the text with padding. */
    var top = m.rows.reduce(function (a, r) { return r.runs > a.runs ? r : a; }, m.rows[0]);
    var ti = m.rows.indexOf(top);
    if (top.runs > 0) {
      if (!top.wkts) {
        g += label(cx(ti), y(top.runs) - 6, String(top.runs),
                   { size: M.font, weight: 800, fill: INK2 });
      } else if (y(0) - y(top.runs) > M.font * 2.4 && barW > M.font * 1.9) {
        g += label(cx(ti), y(top.runs) + M.font + 5, String(top.runs),
                   { size: M.font, weight: 800, fill: inkOn(colour) });
      }
    }

    /* x ticks — the density drops with the width, the type never does */
    var stride = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / M.tick))));
    m.rows.forEach(function (r, i) {
      if (i % stride) return;
      g += label(cx(i), padT + plotH + M.font + 9, String(r.over), { size: M.font });
    });

    /* a hit target is the whole slot, never only the painted bar */
    var hits = '';
    for (var i = 0; i < n; i++) {
      hits += tag('rect', { x: n2(cx(i) - slot / 2), y: n2(padT), width: n2(slot),
                            height: n2(plotH), fill: 'transparent' });
    }

    var cursor = tag('rect', { class: 'mxg-cursor', x: 0, y: n2(padT), width: n2(barW + 10),
                               height: n2(plotH), rx: 6, fill: 'rgba(255, 255, 255, 0.07)',
                               hidden: 'hidden' });

    var aria = m.abv + ' innings: runs off each of ' + n + ' overs, ' + top.runs +
               ' in over ' + top.over + ' the most, ' + m.wkts + ' wickets down.';

    return { svg: svgOpen(w, M.h, aria) + cursor + g + hits + '</svg>', geo: geo };
  }

  /* ------------------------------------------------------------------ worm */

  /* The worm and the run-rate chart are one drawing read two ways: same x, same
     two innings, same emphasis and crosshair — only the y differs. A spec says
     what to plot, what to mark on it, and how to say a value out loud. */
  var LINES = {
    worm: {
      axis: 'Runs',
      caption: 'Cumulative runs by over',
      series: function (m) { return m.trail; },
      marks: function (m) { return m.falls; },        /* a dot per wicket */
      peak: function (m) { return m.total; },
      floor: 10, ticks: 5,
      endAt: function (m) { return { x: m.lastX, y: m.total }; },
      endText: function (m) { return m.abv + ' ' + score(m); },
      valueAt: function (m, ov) { return ov > m.lastOver ? null : m.byOver[ov].runs; },
      readAt: function (m, ov) {
        return ov < 1 ? '0-0' : m.byOver[ov].runs + '-' + m.byOver[ov].wkts;
      },
      tell: function (m) { return m.abv + ' ' + score(m) + ' off ' + oversText(m.lastX) + ' overs'; }
    },
    rate: {
      axis: 'RPO',
      caption: 'Run rate by over',
      series: function (m) { return m.rates; },
      /* no wicket dots here: the rate chart is about the shape of the scoring,
         and the worm above it already carries where the wickets fell */
      marks: function () { return []; },
      peak: function (m) { return m.peakRate; },
      /* a run rate lives in a narrow band, so it gets a finer grid than the
         worm — at five ticks a 0–15 axis lands on fives and buries the 6-to-13
         stretch that every over of the match actually happens in */
      floor: 6, ticks: 6,
      endAt: function (m) { return { x: m.lastX, y: runRate(m) }; },
      endText: function (m) { return m.abv + ' ' + runRate(m).toFixed(2); },
      valueAt: function (m, ov) { return ov < 1 || ov > m.lastOver ? null : m.byOver[ov].rate; },
      readAt: function (m, ov) { return ov < 1 ? '—' : m.byOver[ov].rate.toFixed(2) + ' rpo'; },
      tell: function (m) { return m.abv + ' at ' + runRate(m).toFixed(2) + ' an over'; }
    }
  };

  function lineChart(models, colours, pick, w, M, spec) {
    /* padR clears the "Ov" caption, which rides the over-number baseline */
    var padL = M.padL, padR = 30;
    var padT = Math.round(M.dot + M.font + 16);
    var padB = Math.round(M.font + 16);
    var plotW = Math.max(60, w - padL - padR);
    var plotH = Math.max(60, M.h - padT - padB);

    var xMax = Math.max(1, Math.ceil(models.reduce(function (a, m) { return Math.max(a, m.lastX); }, 0)));
    var peak = models.reduce(function (a, m) { return Math.max(a, spec.peak(m)); }, 0);
    var scale = ticksTo(Math.max(peak, spec.floor), spec.ticks);
    var x = function (v) { return padL + (v / xMax) * plotW; };
    var y = function (v) { return padT + plotH - (v / scale.max) * plotH; };
    var geo = { padL: padL, padT: padT, plotW: plotW, plotH: plotH, w: w,
                xMax: xMax, yMax: scale.max };

    var g = frame(geo, M, scale, { y: y }, spec.axis);

    var stride = Math.max(1, Math.ceil(xMax / Math.max(2, Math.floor(plotW / M.tick))));
    for (var ov = 0; ov <= xMax; ov += stride) {
      g += label(x(ov), padT + plotH + M.font + 9, String(ov), { size: M.font });
    }

    /* the innings the reader is not on is drawn first and stays quiet behind */
    var order = [];
    for (var s = 0; s < models.length; s++) if (s !== pick) order.push(s);
    order.push(pick);

    var ends = [];
    order.forEach(function (i) {
      var m = models[i], colour = colours[i];
      var on = models.length < 2 || i === pick;
      var pts = spec.series(m);
      if (!pts.length) return;

      var d = pts.map(function (p, k) {
        return (k ? 'L' : 'M') + n2(x(p.x)) + ' ' + n2(y(p.y));
      }).join('');

      g += tag('path', { d: d, fill: 'none', stroke: colour, 'stroke-width': on ? 2.5 : 2,
                         'stroke-linejoin': 'round', 'stroke-linecap': 'round',
                         opacity: on ? 1 : 0.42 });

      var tip = spec.endAt(m);
      var marks = '';
      spec.marks(m).forEach(function (f) { marks += dot(x(f.x), y(f.y), M.dot, colour); });
      marks += dot(x(tip.x), y(tip.y), M.dot + 1.5, colour);
      g += tag('g', { opacity: on ? 1 : 0.42 }, marks);

      ends.push({ x: x(tip.x), y: y(tip.y), m: m, on: on });
    });

    /* Direct end labels, but only while the two ends are far enough apart to
       stay attached to their own line. Nudging them apart would detach them
       and read as noise — the legend and the tooltip already carry identity. */
    var clash = ends.length > 1 &&
                Math.abs(ends[0].y - ends[1].y) < M.font * 2.1 &&
                Math.abs(ends[0].x - ends[1].x) < 84;
    if (!clash) {
      ends.forEach(function (e) {
        var near = e.x > padL + plotW - 56;
        g += label(near ? e.x - M.dot - 4 : e.x + M.dot + 4, e.y - M.dot - 6,
                   spec.endText(e.m),
                   { anchor: near ? 'end' : 'start', size: M.font, weight: 700,
                     fill: e.on ? INK2 : INK3 });
      });
    }

    /* the crosshair finds the over — readers aim at an over, not at a 2px line */
    var cross = tag('line', { class: 'mxg-cross__line', x1: 0, y1: n2(padT), x2: 0,
                              y2: n2(padT + plotH), stroke: AXIS, 'stroke-width': 1 });
    for (var k = 0; k < models.length; k++) {
      cross += tag('circle', { class: 'mxg-cross__dot', 'data-s': k, cx: 0, cy: 0, r: 0,
                               fill: colours[k], stroke: SURFACE, 'stroke-width': 2 });
    }
    g += tag('g', { class: 'mxg-cross', hidden: 'hidden' }, cross);
    g += tag('rect', { x: n2(padL), y: n2(padT), width: n2(plotW), height: n2(plotH),
                       fill: 'transparent' });

    var aria = spec.caption + ' — ' + models.map(spec.tell).join(', ') + '.';

    return { svg: svgOpen(w, M.h, aria) + g + '</svg>', geo: geo };
  }

  /* ---------------------------------------------------- innings progression
     Plain HTML rather than SVG: three bars on one shared scale, and a flex row
     reflows at any width for free.
     ---------------------------------------------------------------------- */

  function progression(models, colours, pick) {
    var esc = window.MX.esc;
    /* one scale across both innings, or the two blocks are not comparable */
    var widest = models.reduce(function (a, m) {
      return phases(m).reduce(function (b, p) { return Math.max(b, p.runs); }, a);
    }, 1);

    return '<div class="mxg-prog">' + models.map(function (m, i) {
      var on = models.length < 2 || i === pick;
      var colour = colours[i];

      var rows = phases(m).map(function (p) {
        var pct = Math.max(5, (p.runs / widest) * 100);

        /* pips ride the fill, placed by when in the block the wicket fell; any
           that would sit on top of each other merge the way the badge reads */
        var groups = [];
        p.falls.forEach(function (f) {
          var at = Math.min(1, Math.max(0, (f.x - (p.from - 1)) / (p.to - p.from + 1)));
          var last = groups[groups.length - 1];
          if (last && at - last.at < 0.14) { last.n++; last.at = (last.at + at) / 2; }
          else groups.push({ at: at, n: 1 });
        });

        return '<div class="mxg-phase">' +
                 '<span class="mxg-phase__ov">' + esc(p.label) + '</span>' +
                 '<span class="mxg-phase__track">' +
                   '<span class="mxg-phase__fill" style="width: ' + n2(pct) + '%; --c: ' + colour + '">' +
                     groups.map(function (gp) {
                       return '<span class="mxg-pip" style="left: ' + n2(gp.at * 100) + '%; ' +
                              '--c: ' + colour + '; --ink: ' + inkOn(colour) + '">' +
                              (gp.n > 1 ? esc(gp.n) : '') + 'W</span>';
                     }).join('') +
                   '</span>' +
                 '</span>' +
                 '<span class="mxg-phase__runs"><b>' + esc(p.runs) + '</b>runs' +
                   (p.wkts ? '<small>' + esc(p.wkts) + ' down</small>' : '') +
                 '</span>' +
               '</div>';
      }).join('');

      return '<section class="mxg-prog__inn' + (on ? '' : ' is-quiet') + '">' +
               '<h4 class="mxg-prog__head">' +
                 '<img src="/static/images/squad_logos/' + encodeURIComponent(m.abv) + '.png" ' +
                      'alt="" onerror="this.remove();">' +
                 esc(m.abv) + '<small>' + esc(score(m)) + ' (' + esc(oversText(m.lastX)) + ')</small>' +
               '</h4>' + rows +
             '</section>';
    }).join('') + '</div>';
  }

  /* ================================================================== tables
     Every chart has a table twin, so no value is reachable only by hovering.
     =================================================================== */

  function table(head, rows) {
    var esc = window.MX.esc;
    return '<div class="mx-tablewrap"><table class="mx-table mxg-table">' +
             '<thead><tr>' + head.map(function (h, i) {
               return '<th' + (i ? '' : ' class="mx-col-main"') + '>' + esc(h) + '</th>';
             }).join('') + '</tr></thead>' +
             '<tbody>' + rows.map(function (r) {
               return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
             }).join('') + '</tbody>' +
           '</table></div>';
  }

  /* Rebuilt on every repaint, so a reader who opened it keeps it open. */
  function setTable(host, summary, head, rows) {
    var was = host.querySelector('details');
    var open = was ? was.open : false;
    host.innerHTML = '<details class="mxg-data"' + (open ? ' open' : '') + '>' +
                       '<summary>' + window.MX.esc(summary) + '</summary>' +
                       table(head, rows) +
                     '</details>';
  }

  /* ================================================================== panel */

  var live = null;         /* what is on screen, so a resize knows what to redraw */
  var resizeTimer = null;

  window.renderTabGraphs = function (data) {
    var MX = window.MX;
    var esc = MX.esc;
    var root = document.getElementById('tab-content');

    /* the three team-colour tables straight off main.py */
    var brand = {
      full: data.clr || {},      /* clr   — c1/c2/c3 per side */
      pt: data.ptclr || {},      /* ptclr — the one canonical colour per side */
      squad: data.sqclr || {}    /* sqclr — the crest gradient's two stops */
    };

    /* First innings first here: these charts read in the order the match was
       played, which is the opposite of the overs list. The side comes off each
       innings' own batting team — the score strip is not in batting order.

       The match proper only. The worm and the run rate lay exactly two series
       over each other, and a super over has nothing to draw either way: one
       over is a single Manhattan bar and a two-point worm. It is on the
       scorecard, the commentary and the overs list instead. */
    var models = [];
    MX.inningsPanes(data).slice(0, 2).forEach(function (p, i) {
      var m = innModel(p.src, p.abv || 'Inn ' + (i + 1), p.full);
      /* an innings with no feed yet drops out, so each model carries its own
         pane rather than the two lists being matched up again by index */
      if (m) { m.pane = p; models.push(m); }
    });

    if (!models.length) {
      root.innerHTML =
        '<div class="mx-empty"><span class="material-icons-round">insights</span>' +
        '<b>No graphs yet</b><p>The Manhattan, the worm, the run rate and the ' +
        'phase breakdown draw themselves as soon as the first over is bowled.</p></div>';
      live = null;
      return;
    }

    /* A background poll that brought nothing new must not throw away the
       reader's innings choice, their open table, or a tooltip mid-read. */
    var sig = models.map(function (m) {
      return m.abv + ':' + m.total + '/' + m.wkts + '@' + n2(m.lastX) + '#' + m.trail.length;
    }).join('|');
    var standing = root.querySelector('.mxg-wrap');
    if (standing && standing.getAttribute('data-sig') === sig) return;

    /* which innings the reader was on — read before the old DOM goes */
    var panes = models.map(function (m) {
      return { key: m.pane.key, abv: m.abv, label: m.pane.label, live: m.pane.live };
    });
    var pick = models.length < 2 ? 0 : panes.indexOf(MX.activePane(panes));
    if (pick < 0) pick = models.length - 1;

    var colours = models.length > 1
      ? teamPair(models[0].abv, models[1].abv, brand)
      : [soloColour(models[0].abv, brand)];

    /* one filter row, above everything it scopes */
    var filter = models.length > 1
      ? '<div class="mxg-filter">' +
          '<span class="mxg-filter__label" id="mxgInnLabel">Innings</span>' +
          '<div class="mx-subtabs" role="tablist" aria-labelledby="mxgInnLabel">' +
            panes.map(function (p, i) {
              /* the pills keep the crest gradient the rest of the page uses */
              return MX.subtab(p, i === pick, brand.full);
            }).join('') +
          '</div>' +
        '</div>'
      : '';

    var stage = function (aria) {
      return '<div class="mxg-stage">' +
               '<div class="mxg-plot" tabindex="0" role="group" aria-label="' + esc(aria) +
                 ' Use the left and right arrow keys to step through the overs."></div>' +
               '<div class="mxg-tip" role="status" hidden></div>' +
             '</div>';
    };

    var legend = models.length > 1
      ? '<div class="mxg-legend">' + models.map(function (m, i) {
          return '<span class="mxg-legend__item" data-s="' + i + '">' +
                   '<img src="/static/images/squad_logos/' + encodeURIComponent(m.abv) +
                     '.png" alt="" onerror="this.remove();">' +
                   '<i class="mxg-legend__line" style="--c: ' + colours[i] + '"></i>' +
                   esc(m.abv) + '</span>';
        }).join('') + '</div>'
      : '';

    root.innerHTML =
      '<div class="mxg-wrap" data-sig="' + esc(sig) + '">' + filter +

      '<section class="mx-card mxg-card" data-chart="manhattan">' +
        '<div class="mx-card__head"><span class="material-icons-round">bar_chart</span>' +
          'Manhattan<small data-readout></small></div>' +
        '<figure class="mxg-fig">' + stage('Runs off each over.') +
          '<figcaption class="mxg-cap">Runs off every over of the selected innings.' +
            '<span class="mxg-key"><i class="mxg-key__dot"></i>wicket</span>' +
            '<span class="mxg-hint">Tap or drag for any over</span></figcaption>' +
        '</figure>' +
        '<div data-table></div>' +
      '</section>' +

      '<section class="mx-card mxg-card" data-chart="worm">' +
        '<div class="mx-card__head"><span class="material-icons-round">show_chart</span>' +
          'Worm<small data-readout></small></div>' + legend +
        '<figure class="mxg-fig">' + stage('Cumulative runs by over.') +
          '<figcaption class="mxg-cap">Both innings side by side — the one picked above ' +
            'leads, the other stays for comparison. Dots mark wickets.' +
            '<span class="mxg-hint">Tap or drag for any over</span></figcaption>' +
        '</figure>' +
        '<div data-table></div>' +
      '</section>' +

      /* the same two innings again, divided by the overs they took: the worm
         says who is ahead, this says who is going faster */
      '<section class="mx-card mxg-card" data-chart="rate">' +
        '<div class="mx-card__head"><span class="material-icons-round">speed</span>' +
          'Run rate<small data-readout></small></div>' + legend +
        '<figure class="mxg-fig">' + stage('Run rate by over.') +
          '<figcaption class="mxg-cap">Runs per over as the innings stood at the end of ' +
            'each over — the worm above, divided by the overs it took.' +
            '<span class="mxg-hint">Tap or drag for any over</span></figcaption>' +
        '</figure>' +
        '<div data-table></div>' +
      '</section>' +

      '<section class="mx-card mxg-card" data-chart="prog">' +
        '<div class="mx-card__head"><span class="material-icons-round">splitscreen</span>' +
          'Innings progression<small>Powerplay · Middle · Death</small></div>' +
        '<figure class="mxg-fig mxg-fig--flat"><div data-prog></div>' +
          '<figcaption class="mxg-cap">Runs in each block, on one scale across both ' +
            'innings. Badges mark where the wickets fell.</figcaption>' +
        '</figure>' +
        '<div data-table></div>' +
      '</section>' +

      '</div>';

    live = { root: root.querySelector('.mxg-wrap'), models: models, colours: colours, pick: pick };
    wire();
    paint();
  };

  /* --------------------------------------------------------------- painting */

  function paint() {
    if (!live || !document.body.contains(live.root)) { live = null; return; }
    var models = live.models, colours = live.colours, pick = live.pick;
    var sel = models[pick];

    /* the chrome around a chart — the wicket key, the disclosure marker —
       follows the selected innings without the stylesheet knowing team hexes */
    live.root.style.setProperty('--mxg-c', colours[pick]);

    /* --- Manhattan -------------------------------------------------------- */
    var mCard = live.root.querySelector('[data-chart="manhattan"]');
    var mPlot = mCard.querySelector('.mxg-plot');
    var mW = mPlot.clientWidth || live.root.clientWidth || 320;
    var mDrawn = manhattan(sel, colours[pick], mW, metrics(mW));
    mPlot.innerHTML = mDrawn.svg;
    mPlot.__chart = { kind: 'manhattan', geo: mDrawn.geo, model: sel, colour: colours[pick] };
    mCard.querySelector('[data-readout]').textContent =
      sel.abv + ' ' + score(sel) + ' (' + oversText(sel.lastX) + ')';
    setTable(mCard.querySelector('[data-table]'), 'View ' + sel.abv + ' over by over',
      ['Over', 'Runs', 'Wkts', 'Score'],
      sel.rows.map(function (r) { return [r.over, r.runs, r.wkts || '—', r.end + '-' + r.down]; }));

    /* --- worm, then the same picture read as a rate ------------------------ */
    [
      { id: 'worm', spec: LINES.worm,
        readout: models.map(function (m) { return m.abv + ' ' + score(m); }).join('  ·  '),
        summary: 'View the innings over by over',
        cell: function (m, ov) { return m.byOver[ov].runs + '-' + m.byOver[ov].wkts; } },
      { id: 'rate', spec: LINES.rate,
        readout: models.map(function (m) { return m.abv + ' ' + runRate(m).toFixed(2); }).join('  ·  '),
        summary: 'View the run rate over by over',
        cell: function (m, ov) { return m.byOver[ov].rate.toFixed(2); } }
    ].forEach(function (chart) {
      var card = live.root.querySelector('[data-chart="' + chart.id + '"]');
      var plot = card.querySelector('.mxg-plot');
      var width = plot.clientWidth || live.root.clientWidth || 320;
      var drawn = lineChart(models, colours, pick, width, metrics(width), chart.spec);

      plot.innerHTML = drawn.svg;
      plot.__chart = { kind: chart.id, spec: chart.spec, geo: drawn.geo,
                       models: models, colours: colours };
      card.querySelector('[data-readout]').textContent = chart.readout;
      card.querySelectorAll('.mxg-legend__item').forEach(function (el) {
        el.classList.toggle('is-quiet', models.length > 1 && +el.getAttribute('data-s') !== pick);
      });

      var rows = [];
      for (var ov = 1; ov <= drawn.geo.xMax; ov++) {
        rows.push([ov].concat(models.map(function (m) {
          return ov > m.lastOver ? '—' : chart.cell(m, ov);
        })));
      }
      setTable(card.querySelector('[data-table]'), chart.summary,
        ['Over'].concat(models.map(function (m) { return m.abv; })), rows);
    });

    /* --- progression ------------------------------------------------------ */
    var pCard = live.root.querySelector('[data-chart="prog"]');
    pCard.querySelector('[data-prog]').innerHTML = progression(models, colours, pick);
    var pRows = [];
    models.forEach(function (m) {
      phases(m).forEach(function (p) {
        pRows.push([m.abv, p.label, p.runs, p.wkts || '—', p.rate]);
      });
    });
    setTable(pCard.querySelector('[data-table]'), 'View every phase',
      ['Innings', 'Overs', 'Runs', 'Wkts', 'Run rate'], pRows);
  }

  /* --------------------------------------------------------------- tooltips
     They enhance and never gate: the same numbers sit in the table views, and
     a keyboard cursor reaches every one of them.
     ---------------------------------------------------------------------- */

  function readout(plot, at) {
    var chart = plot.__chart;
    if (!chart) return null;

    if (chart.kind === 'manhattan') {
      var r = chart.model.rows[at];
      if (!r) return null;
      return {
        x: chart.geo.padL + chart.geo.slot * at + chart.geo.slot / 2,
        head: 'Over ' + r.over,
        rows: [{ c: chart.colour, name: chart.model.abv, value: r.runs + (r.runs === 1 ? ' run' : ' runs') },
               { c: null, name: 'score', value: r.end + '-' + r.down }]
          .concat(r.wkts ? [{ c: null, name: r.wkts === 1 ? 'wicket' : 'wickets', value: String(r.wkts) }] : [])
      };
    }

    var ov = Math.max(0, Math.min(chart.geo.xMax, at));
    return {
      x: chart.geo.padL + (ov / chart.geo.xMax) * chart.geo.plotW,
      head: ov === 0 ? 'Before a ball was bowled' : 'End of over ' + ov,
      rows: chart.models.map(function (m, i) {
        return {
          c: chart.colours[i], name: m.abv,
          value: ov > m.lastOver ? 'innings closed' : chart.spec.readAt(m, ov)
        };
      })
    };
  }

  /* Team names come off the feed, so they go in as text nodes, never markup. */
  function showTip(plot, at) {
    var tip = plot.parentNode.querySelector('.mxg-tip');
    var info = readout(plot, at);
    if (!tip || !info) return;

    tip.textContent = '';
    var head = document.createElement('b');
    head.className = 'mxg-tip__head';
    head.textContent = info.head;
    tip.appendChild(head);

    info.rows.forEach(function (r) {
      var row = document.createElement('span');
      row.className = 'mxg-tip__row';
      if (r.c) {
        var key = document.createElement('i');            /* a line key, not a block */
        key.style.setProperty('--c', r.c);
        row.appendChild(key);
      }
      var value = document.createElement('b');            /* the value leads */
      value.textContent = r.value;
      row.appendChild(value);
      row.appendChild(document.createTextNode(r.name));
      tip.appendChild(row);
    });

    tip.hidden = false;
    var half = tip.offsetWidth / 2 + 6;
    tip.style.left = Math.min(Math.max(info.x, half), (plot.clientWidth || 1) - half) + 'px';

    var chart = plot.__chart;
    if (chart.kind === 'manhattan') {
      var cursor = plot.querySelector('.mxg-cursor');
      if (!cursor) return;
      cursor.removeAttribute('hidden');
      cursor.setAttribute('x', n2(info.x - (chart.geo.barW + 10) / 2));
      return;
    }

    var cross = plot.querySelector('.mxg-cross');
    if (!cross) return;
    cross.removeAttribute('hidden');
    cross.querySelectorAll('.mxg-cross__line').forEach(function (l) {
      l.setAttribute('x1', n2(info.x));
      l.setAttribute('x2', n2(info.x));
    });
    var ov = Math.max(0, Math.min(chart.geo.xMax, at));
    var r = metrics(plot.clientWidth || 320).dot + 1;
    cross.querySelectorAll('.mxg-cross__dot').forEach(function (d) {
      var m = chart.models[+d.getAttribute('data-s')];
      var v = m ? chart.spec.valueAt(m, ov) : null;
      if (v === null || v === undefined) { d.setAttribute('r', 0); return; }
      d.setAttribute('r', n2(r));
      d.setAttribute('cx', n2(info.x));
      d.setAttribute('cy', n2(chart.geo.padT + chart.geo.plotH -
                             (v / chart.geo.yMax) * chart.geo.plotH));
    });
  }

  function hideTip(plot) {
    var tip = plot.parentNode.querySelector('.mxg-tip');
    if (tip) tip.hidden = true;
    [plot.querySelector('.mxg-cursor'), plot.querySelector('.mxg-cross')].forEach(function (el) {
      if (el) el.setAttribute('hidden', 'hidden');
    });
  }

  function indexAt(plot, clientX) {
    var chart = plot.__chart;
    if (!chart) return 0;
    var at = clientX - plot.getBoundingClientRect().left - chart.geo.padL;
    if (chart.kind === 'manhattan') {
      return Math.max(0, Math.min(chart.geo.n - 1, Math.floor(at / chart.geo.slot)));
    }
    return Math.max(0, Math.min(chart.geo.xMax, Math.round((at / chart.geo.plotW) * chart.geo.xMax)));
  }

  /* ----------------------------------------------------------------- wiring */

  function wire() {
    var wrap = live.root;

    wrap.querySelectorAll('.mx-subtab').forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        if (i === live.pick) return;
        live.pick = i;
        wrap.querySelectorAll('.mx-subtab').forEach(function (other, j) {
          other.setAttribute('aria-selected', String(j === i));
        });
        paint();
      });
    });

    wrap.querySelectorAll('.mxg-plot').forEach(function (plot) {
      var cursor = 0;
      var holding = false;

      function track(e) {
        cursor = indexAt(plot, e.clientX);
        showTip(plot, cursor);
      }

      /* A finger has no hover. The readout has to come up on the touch itself,
         track while it slides, and stay up once it lifts — a touch pointer
         fires pointerleave the instant it is raised, so the mouse teardown
         below has to be told apart from it or the panel blanks on every tap. */
      plot.addEventListener('pointerdown', function (e) {
        holding = true;
        track(e);
        /* keep the moves coming even if the finger strays off the plot */
        if (plot.setPointerCapture) {
          try { plot.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
        }
      });

      plot.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse' && !holding) return;
        track(e);
      });

      plot.addEventListener('pointerup', function () { holding = false; });

      /* the browser claimed the gesture as a page scroll — let it go */
      plot.addEventListener('pointercancel', function (e) {
        holding = false;
        if (e.pointerType !== 'mouse') hideTip(plot);
      });

      plot.addEventListener('pointerleave', function (e) {
        if (e.pointerType === 'mouse') hideTip(plot);
      });

      plot.addEventListener('blur', function () { hideTip(plot); });

      plot.addEventListener('keydown', function (e) {
        var chart = plot.__chart;
        if (!chart) return;
        var top = chart.kind === 'manhattan' ? chart.geo.n - 1 : chart.geo.xMax;
        if (e.key === 'Home') cursor = 0;
        else if (e.key === 'End') cursor = top;
        else if (e.key === 'ArrowRight') cursor = Math.min(top, cursor + 1);
        else if (e.key === 'ArrowLeft') cursor = Math.max(0, cursor - 1);
        else return;
        showTip(plot, cursor);
        e.preventDefault();
      });
    });

    /* one listener for the page, not one per render */
    if (wire.bound) return;
    wire.bound = true;

    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(paint, 140);
    });

    /* A touch readout stays up after the finger lifts, so something has to put
       it away: a tap anywhere else. Capture phase, so the plot that was just
       tapped still gets to raise its own readout afterwards. iOS does not
       focus a tabindex div on tap, so the blur handler cannot cover this. */
    document.addEventListener('pointerdown', function (e) {
      if (!live || !document.body.contains(live.root)) return;
      live.root.querySelectorAll('.mxg-plot').forEach(function (plot) {
        if (!plot.contains(e.target)) hideTip(plot);
      });
    }, true);
  }
})();

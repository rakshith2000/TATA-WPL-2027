/* ==========================================================================
   WPL 2027 · Match centre — Scorecard panel
   Awards and top performers once the match is settled, then the full card for
   each innings: batting, extras, total, bowling and the fall of wickets.
   Shared helpers come from window.MX (js/match.js).
   ========================================================================== */

function parseOvers(oversStr) {
    /* "3.2" -> 20 balls, so part-overs sort correctly */
    const [whole, part] = String(oversStr).split('.').map(Number);
    return (whole || 0) * 6 + (isNaN(part) ? 0 : part);
}

/* Top performers come from the match proper only. A super over is scored
   separately in the record books, and three balls at the death would otherwise
   list the same player twice — once for the innings, once for the decider. */
function mainInnings(innings) {
    return innings.slice(0, 2);
}

function getTopBatters(innings) {
    const all = mainInnings(innings).reduce((list, i) => list.concat(i.batting || []), []);
    return all.slice().sort((a, b) => {
        if (Number(a.runs) !== Number(b.runs)) return Number(b.runs) - Number(a.runs);
        return Number(a.balls) - Number(b.balls);   /* fewer balls for the same runs */
    });
}

function getTopBowlers(innings) {
    const all = mainInnings(innings).reduce((list, i) => list.concat(i.bowling || []), []);
    return all.slice().sort((a, b) => {
        if (Number(a.wickets) !== Number(b.wickets)) return Number(b.wickets) - Number(a.wickets);
        if (Number(a.runs) !== Number(b.runs)) return Number(a.runs) - Number(b.runs);
        return parseOvers(a.overs) - parseOvers(b.overs);
    });
}

function renderTabScorecard(data) {
    const MX = window.MX;
    const esc = MX.esc;
    const dt3 = data.dt3 || {};
    const fn = data.fn || {};
    const clr2 = data.clr2 || {};
    /* every innings the feed carries, super overs included */
    const panes = MX.inningsPanes(data);
    const innings = panes.map(p => p.inn);
    const info = String(dt3.info || '');
    const settled = /\b(won|tied)\b/i.test(info);

    let html = '';

    /* --- awards ----------------------------------------------------------- */
    if (settled) {
        html += MX.awardCard(dt3.player_of_match, 'Player of the match', 'military_tech', fn, clr2, true);
        html += MX.awardCard(dt3.player_of_series, 'Player of the series', 'workspace_premium', fn, clr2, false);
    }

    /* --- top performers --------------------------------------------------- */
    if (settled && innings.length) {
        const bats = getTopBatters(innings).slice(0, 2);
        const bowls = getTopBowlers(innings).slice(0, 2);

        const batRows = bats.map(b => topRow(MX, b,
            esc(b.runs) + (b.out_str === 'Not out' ? '*' : ''), '(' + esc(b.balls) + ')')).join('');
        const bowlRows = bowls.map(b => topRow(MX, b,
            esc(b.wickets) + '/' + esc(b.runs), '(' + esc(b.overs) + ')')).join('');

        html += '<div class="mx-card">' +
                  '<div class="mx-card__head"><span class="material-icons-round">star</span>Top performers</div>' +
                  '<div class="mx-top">' +
                    '<div class="mx-top__col"><div class="mx-top__head">Batters</div>' + batRows + '</div>' +
                    '<div class="mx-top__col"><div class="mx-top__head">Bowlers</div>' + bowlRows + '</div>' +
                  '</div>' +
                '</div>';
    }

    /* --- one pane per innings --------------------------------------------- */
    if (!panes.length) {
        document.getElementById('tab-content').innerHTML = html ||
            '<div class="mx-empty"><span class="material-icons-round">list_alt</span>' +
            '<b>No scorecard yet</b><p>The card fills in as soon as the first innings is under way.</p></div>';
        return;
    }

    const active = MX.activePane(panes);
    let tabs = '';
    let bodies = '';

    panes.forEach(p => {
        const on = p === active;
        tabs += MX.subtab(p, on, clr2);
        bodies += '<div class="mx-pane" data-inn="' + esc(p.key) + '"' + (on ? '' : ' hidden') + '>' +
                    inningsCard(p, dt3, MX, clr2) +
                  '</div>';
    });

    html += '<div class="mx-subtabs" role="tablist" aria-label="Innings">' + tabs + '</div>' + bodies;

    const root = document.getElementById('tab-content');
    root.innerHTML = html;
    MX.wireSubtabs(root);
}

/* ------------------------------------------------------------------ pieces */

function topRow(MX, player, figure, sub) {
    const team = player.team || 'NA';
    return '<a class="mx-top__row' + (team === 'NA' ? ' is-off' : '') + '" href="' +
             MX.playerHref(team, player.name) + '">' +
             MX.playerPic(team, player.name, 'mx-top__pic', false) +
             '<span class="mx-top__id">' +
               '<span class="mx-top__name">' + MX.esc(player.name) + '</span>' +
               '<span class="mx-top__fig">' + figure + ' <span>' + sub + '</span></span>' +
             '</span>' +
           '</a>';
}

function inningsCard(pane, dt3, MX, clr2) {
    const esc = MX.esc;
    const i = pane.inn;

    /* --- batting ---------------------------------------------------------- */
    let batRows = '';
    (i.batting || []).forEach(b => {
        const notOut = b.out_str === 'Not out';
        batRows += '<tr>' +
                     '<td>' + MX.playerLink(b, '') +
                       (b.is_captain ? '<span class="mx-plr__badge">(C)</span>' : '') +
                       '<span class="mx-out' + (notOut ? ' mx-out--not' : '') + '">' + esc(b.out_str) + '</span>' +
                     '</td>' +
                     '<td><b>' + esc(b.runs) + '</b></td><td>' + esc(b.balls) + '</td>' +
                     '<td>' + esc(b.fours) + '</td><td>' + esc(b.sixes) + '</td>' +
                     '<td>' + esc(b.strike_rate) + '</td>' +
                   '</tr>';
    });

    /* --- yet to bat / did not bat -----------------------------------------
       Skipped for a super over: three batters are all the rules allow, so the
       feed lists the whole rest of the XI as not having batted, which says
       nothing and buries the three lines that matter. */
    let rest = '';
    const notBatted = pane.so ? [] : (i.not_batted || []);
    if (notBatted.length) {
        const label = dt3.match_status === 'post' ? "Didn't bat"
                    : (pane.live ? 'Yet to bat' : "Didn't bat");
        rest = '<div class="mx-inn__yet"><b>' + label + '</b>' +
                 notBatted.map(nb => {
                     const team = nb.team || 'NA';
                     return '<a class="' + (team === 'NA' ? 'is-off' : '') + '" href="' +
                            MX.playerHref(team, nb.name) + '">' + esc(nb.name) + '</a>';
                 }).join(', ') +
               '</div>';
    }

    /* --- bowling ---------------------------------------------------------- */
    let bowlRows = '';
    (i.bowling || []).forEach(b => {
        bowlRows += '<tr>' +
                      '<td>' + MX.playerLink(b, '') + '</td>' +
                      '<td>' + esc(b.overs) + '</td><td>' + esc(b.maiden_overs) + '</td>' +
                      '<td>' + esc(b.runs) + '</td><td><b>' + esc(b.wickets) + '</b></td>' +
                      '<td>' + esc(b.economy) + '</td><td>' + esc(b.extras) + '</td>' +
                    '</tr>';
    });

    /* --- fall of wickets --------------------------------------------------- */
    let fowRows = '';
    (i.fall_of_wickets || []).forEach((w, n) => {
        fowRows += '<tr>' +
                     '<td>' + MX.playerLink(w, '') + '</td>' +
                     '<td><b>' + esc(w.score) + '</b></td>' +
                     '<td>' + esc(w.over) + '</td>' +
                     '<td>' + (n + 1) + '</td>' +
                   '</tr>';
    });

    return '<div class="mx-card">' +
             '<div class="mx-card__head mx-card__head--team" style="' + MX.tint(pane.abv, clr2) + '">' +
               '<span class="material-icons-round">' +
                 (pane.so ? 'bolt' : 'sports_cricket') + '</span>' + esc(pane.label) +
               (pane.live ? '' : '') +
             '</div>' +

             '<div class="mx-tablewrap"><table class="mx-table">' +
               '<thead><tr><th class="mx-col-main">Batter</th><th>R</th><th>B</th>' +
               '<th>4s</th><th>6s</th><th>SR</th></tr></thead>' +
               '<tbody>' + batRows + '</tbody>' +
             '</table></div>' +

             rest +

             '<div class="mx-inn__extras">Extras <b>' + esc(i.extras) + '</b> ' +
               '(b ' + esc(i.bye) + ', lb ' + esc(i.legbye) + ', w ' + esc(i.wide) +
               ', nb ' + esc(i.noball) + ', p ' + esc(i.penalties) + ')</div>' +

             '<div class="mx-inn__total">' +
               '<b>' + esc(i.runs) + '/' + esc(i.wickets) + '</b>' +
               '<span>' + esc(i.overs) + ' overs</span>' +
               '<span class="mx-inn__crr">Run rate <b>' + esc(i.run_rate) + '</b></span>' +
             '</div>' +

             (bowlRows
               ? '<div class="mx-sub">Bowling</div>' +
                 '<div class="mx-tablewrap"><table class="mx-table">' +
                   '<thead><tr><th class="mx-col-main">Bowler</th><th>O</th><th>M</th><th>R</th>' +
                   '<th>W</th><th>ER</th><th>Ext</th></tr></thead>' +
                   '<tbody>' + bowlRows + '</tbody>' +
                 '</table></div>'
               : '') +

             (fowRows
               ? '<div class="mx-sub">Fall of wickets</div>' +
                 '<div class="mx-tablewrap"><table class="mx-table">' +
                   '<thead><tr><th class="mx-col-main">Batter</th><th>Score</th><th>Over</th><th>Wkt</th></tr></thead>' +
                   '<tbody>' + fowRows + '</tbody>' +
                 '</table></div>'
               : '') +
           '</div>';
}

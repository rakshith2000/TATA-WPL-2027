/* ==========================================================================
   WPL 2027 · Match centre — Live panel
   Recent overs strip, win probability, who is at the crease, then ball-by-ball
   commentary per innings. Once there is a winner it becomes the commentary
   archive, with the awards on top.

   Ball maths (what a delivery scored, what an over came to, who faced it)
   lives on window.MX in js/match.js, shared with the Overs panel.
   ========================================================================== */

/* Bold everything up to and including the first "...!" — the feed uses that
   word as the headline of a commentary line ("FOUR! ..."). */
function boldSubstring(value) {
    return String(value).replace(/(\b\w+!)/, '<b>$1</b>');
}

function renderTabLive(data) {
    const MX = window.MX;
    const esc = MX.esc;
    const dt1 = (data.dt1 || [{}])[0];
    const dt3 = data.dt3 || {};
    const fn = data.fn || {};
    const clr = data.clr || {};        /* one brand colour per team */
    const clr2 = data.clr2 || {};      /* the full c1/c2/c3 set */
    const info = String(dt3.info || '');
    const over = /\b(won|abandoned|no result|tied)\b/i.test(info);

    let html = '';

    /* --- recent overs ---------------------------------------------------- */
    if (Array.isArray(dt3.overs_timeline_v2) && dt3.overs_timeline_v2.length) {
        let bar = '';
        /* the feed sends newest first; the strip reads left to right */
        dt3.overs_timeline_v2.slice().reverse().forEach(ov => {
            let balls = '';
            (ov.summary || []).forEach(b => { balls += MX.ball(MX.stripBallScore(b)); });
            bar += '<div class="mx-over-group">' +
                     '<span class="mx-over-group__label">Ov ' + esc(String(ov.over).split('.')[0]) + '</span>' +
                     '<span class="mx-over-group__balls">' + balls + '</span>' +
                     '<span class="mx-over-group__label">= ' +
                     '<span class="mx-over-group__total">' + esc(ov.runs) + '</span>' +
                   '</div>';
        });

        html += '<div class="mx-card">' +
                  '<div class="mx-card__head"><span class="material-icons-round">timeline</span>' +
                    'Recent overs<small>Latest at the end</small></div>' +
                  '<div class="mx-timeline"><div class="mx-timeline__bar">' + bar + '</div></div>' +
                '</div>';
    }

    /* --- win probability -------------------------------------------------- */
    const prob = dt3.team_win_probability;
    if (!over && prob && Object.keys(prob).length) {
        const a = parseFloat(prob[dt1.Team_A]);
        const b = parseFloat(prob[dt1.Team_B]);
        if (!isNaN(a) && !isNaN(b)) {
            const ca = esc(clr[dt1.Team_A] || '#29c5e8');
            const cb = esc(clr[dt1.Team_B] || '#c77dff');
            html += '<div class="mx-card">' +
                      '<div class="mx-card__head"><span class="material-icons-round">insights</span>Win probability</div>' +
                      '<div class="mx-prob">' +
                        '<div class="mx-prob__head">' +
                          MX.crest(dt1.Team_A, clr2, 'mx-crest--sm') +
                          '<span class="mx-prob__mid">Chance of winning</span>' +
                          MX.crest(dt1.Team_B, clr2, 'mx-crest--sm') +
                        '</div>' +
                        '<div class="mx-prob__bar">' +
                          '<span class="mx-prob__seg mx-prob__seg--a" style="--c: ' + ca + '; width: ' + a.toFixed(1) + '%"></span>' +
                          '<span class="mx-prob__seg mx-prob__seg--b" style="--c: ' + cb + '; width: ' + b.toFixed(1) + '%"></span>' +
                        '</div>' +
                        '<div class="mx-prob__foot">' +
                          '<span style="color: ' + ca + '">' + a.toFixed(1) + '%</span>' +
                          '<span style="color: ' + cb + '">' + b.toFixed(1) + '%</span>' +
                        '</div>' +
                      '</div>' +
                    '</div>';
        }
    }

    /* --- awards, once there is a winner ---------------------------------- */
    if (over) {
        html += MX.awardCard(dt3.player_of_match, 'Player of the match', 'military_tech', fn, clr2, true);
        html += MX.awardCard(dt3.player_of_series, 'Player of the series', 'workspace_premium', fn, clr2, false);
    }

    /* --- at the crease ---------------------------------------------------- */
    if (!over && (dt3.innings || []).length) {
        const bat = dt3.now_batting || {};
        const bowl = dt3.now_bowling || {};
        let batRows = '';
        let bowlRows = '';

        ['b1', 'b2'].forEach((k, i) => {
            const p = bat[k];
            if (!p || !p.name) return;
            const s = p.stats || {};
            batRows += '<tr>' +
                         '<td>' + MX.playerLink(p, i === 0 ? '/static/images/Bat.svg' : '') + '</td>' +
                         '<td><b>' + esc(s.runs) + '</b></td><td>' + esc(s.balls) + '</td>' +
                         '<td>' + esc(s.fours) + '</td><td>' + esc(s.sixes) + '</td>' +
                         '<td>' + esc(s.strike_rate) + '</td>' +
                       '</tr>';
        });

        ['b1', 'b2'].forEach((k, i) => {
            const p = bowl[k];
            if (!p || !p.name) return;
            const s = p.stats || {};
            bowlRows += '<tr>' +
                          '<td>' + MX.playerLink(p, i === 0 ? '/static/images/Ball.svg' : '') + '</td>' +
                          '<td>' + esc(s.overs) + '</td><td>' + esc(s.maiden_overs) + '</td>' +
                          '<td>' + esc(s.runs) + '</td><td><b>' + esc(s.wickets) + '</b></td>' +
                          '<td>' + esc(s.economy) + '</td>' +
                        '</tr>';
        });

        if (batRows || bowlRows) {
            html += '<div class="mx-card">' +
                      '<div class="mx-card__head"><span class="material-icons-round">sports_cricket</span>At the crease</div>' +
                      '<div class="mx-tablewrap"><table class="mx-table">' +
                        (batRows ? '<thead><tr><th class="mx-col-main">Batters</th><th>R</th><th>B</th>' +
                                   '<th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>' + batRows + '</tbody>' : '') +
                        (bowlRows ? '<thead><tr><th class="mx-col-main">Bowlers</th><th>O</th><th>M</th>' +
                                    '<th>R</th><th>W</th><th>ER</th></tr></thead><tbody>' + bowlRows + '</tbody>' : '') +
                      '</table></div>' +
                    '</div>';
        }
    }

    /* --- commentary, one pane per innings ---------------------------------
       Every innings the scorecard feed carries, super overs included — each
       pane's `src` is the matching apiv2 call, which live.py now makes one per
       innings rather than two flat. */
    const panes = MX.inningsPanes(data);

    if (panes.length) {
        const active = MX.activePane(panes);
        let tabs = '';
        let bodies = '';
        panes.forEach(p => {
            const on = p === active;
            tabs += MX.subtab(p, on, clr2);
            bodies += '<div class="mx-card mx-pane" data-inn="' + esc(p.key) + '"' + (on ? '' : ' hidden') + '>' +
                        commentary(p, MX) +
                      '</div>';
        });

        html += '<div class="mx-subtabs" role="tablist" aria-label="Innings">' + tabs + '</div>' + bodies;
    }

    if (!html) {
        html = '<div class="mx-empty"><span class="material-icons-round">hourglass_empty</span>' +
               '<b>Nothing to show yet</b><p>Commentary starts once the first ball is bowled.</p></div>';
    }

    const root = document.getElementById('tab-content');
    root.innerHTML = html;

    MX.wireSubtabs(root);
    wireTimeline(root);

    window.dispatchEvent(new Event('statsReady'));
}

/* ------------------------------------------------------------------ pieces */

/* One innings of commentary. The feed hands the overs back newest first, and
   marks the end of an over on the first comment of its last ball — so the
   summary band is emitted just before that ball's line. */
function commentary(pane, MX) {
    const esc = MX.esc;
    const inn = pane.src && pane.src.inning;
    if (!inn || !Array.isArray(inn.overs) || !inn.overs.length) {
        /* The two feeds are independent, and a super over is the innings the
           ball-by-ball one is most likely to be missing altogether — so say
           which of the two it is rather than always promising it is coming. */
        const bowled = parseFloat((pane.inn || {}).overs) > 0;
        return '<div class="mx-empty"><span class="material-icons-round">chat_bubble_outline</span>' +
               (bowled
                 ? '<b>No commentary for this innings</b>' +
                   '<p>The ball-by-ball feed has not published it.</p>'
                 : '<b>No commentary yet</b>' +
                   '<p>Ball-by-ball updates appear here once the innings begins.</p>') +
               '</div>';
    }

    let html = '<div class="mx-comm">';

    inn.overs.forEach(ov => {
        if (ov.overNumber === 0) return;
        (ov.balls || []).forEach(ball => {
            const comments = ball.comments || [];

            if (comments[0] && comments[0].commentTypeId === 'EndOfOver') {
                let chips = '';
                ov.balls.slice().reverse().forEach(b => { chips += MX.ball(MX.ballScore(b)); });

                const msg = String(comments[0].message || '');
                const bowler = msg.split('Bowler: ')[1] ? msg.split('Bowler: ')[1].split('.')[0] : '';

                html += '<div class="mx-comm__over">' +
                          '<span class="mx-comm__ovno">Over ' + esc(ov.overNumber) + '</span>' +
                          '<span class="mx-comm__ovscore">' + esc(ov.totalInningRuns) + '/' +
                            esc(ov.totalInningWickets) + '</span>' +
                          '<span class="mx-comm__ovballs">' + chips + '</span>' +
                          '<span class="mx-comm__ovruns">' + MX.overRuns(ov) + ' runs</span>' +
                          '<span class="mx-comm__who"><b>' + esc(bowler) + '</b> to ' +
                            MX.overBatsmen(ov).map(esc).join(', ') + '</span>' +
                        '</div>';
            }

            const score = String(MX.ballScore(ball));
            const tone = MX.ballClass(score).replace('mx-ball--', '');
            const line = comments.length ? comments[comments.length - 1].message : '';

            html += '<div class="mx-comm__ball' + (tone ? ' is-' + tone : '') + '">' +
                      '<span class="mx-comm__mark">' +
                        '<span class="mx-comm__no">' + esc((ov.overNumber - 1) + '.' + ball.ballNumber) + '</span>' +
                        MX.ball(score) +
                      '</span>' +
                      '<span class="mx-comm__text">' + boldSubstring(esc(line)) + '</span>' +
                    '</div>';
        });
    });

    return html + '</div>';
}

/* ------------------------------------------------------------------ wiring */

/* The overs strip opens on the latest over, but a reader who has scrolled
   back through it keeps their place across a refresh. */
function wireTimeline(root) {
    const wrap = root.querySelector('.mx-timeline');
    const bar = root.querySelector('.mx-timeline__bar');
    if (!wrap || !bar) return;

    function fade() {
        const max = bar.scrollWidth - bar.clientWidth;
        wrap.classList.toggle('at-start', bar.scrollLeft <= 0);
        wrap.classList.toggle('at-end', bar.scrollLeft >= max - 1);
    }

    const keep = window.__mxTimeline;
    bar.scrollLeft = keep && keep.atEnd === false ? keep.left : bar.scrollWidth;

    bar.addEventListener('scroll', () => {
        const max = bar.scrollWidth - bar.clientWidth;
        window.__mxTimeline = { left: bar.scrollLeft, atEnd: bar.scrollLeft >= max - 8 };
        fade();
    }, { passive: true });

    window.addEventListener('resize', fade);
    fade();
}

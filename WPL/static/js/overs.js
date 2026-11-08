/* ==========================================================================
   WPL 2027 · Match centre — Overs panel
   Every over of the match, newest first: who bowled it to whom, the six balls
   and what it cost. Latest innings on top, working back to the first, which is
   the order they are read in — so a super over leads once there has been one.

   Ball maths lives on window.MX (js/match.js), shared with the Live panel.
   ========================================================================== */

function renderTabOvers(data) {
    const MX = window.MX;
    const esc = MX.esc;
    const clr = data.clr || {};          /* the full c1/c2/c3 set on this route */

    /* Newest innings first. The side comes off each innings' own batting team
       rather than the score strip, which has one row per side however many
       innings were played and is not in batting order. */
    const blocks = MX.inningsPanes(data).slice().reverse()
        .filter(p => p.src && p.src.inning && (p.src.inning.overs || []).length);

    if (!blocks.length) {
        document.getElementById('tab-content').innerHTML =
            '<div class="mx-empty"><span class="material-icons-round">av_timer</span>' +
            '<b>No overs yet</b><p>Each over lands here as soon as it is bowled.</p></div>';
        return;
    }

    let html = '';

    blocks.forEach(pane => {
        let rows = '';

        pane.src.inning.overs.forEach(over => {
            if (over.overNumber === 0) return;

            const balls = over.balls || [];
            const first = balls[0] || {};
            const comments = first.comments || [];

            /* the bowler is named in the end-of-over line when there is one,
               otherwise it has to be read off the last delivery's commentary */
            let bowler = '';
            if (comments[0] && comments[0].commentTypeId === 'EndOfOver') {
                const msg = String(comments[0].message || '');
                bowler = msg.split('Bowler: ')[1] ? msg.split('Bowler: ')[1].split('.')[0] : '';
            } else if (comments.length) {
                const msg = String(comments[comments.length - 1].message || '');
                bowler = msg.split(' to ')[0].split(' ').slice(-2).join(' ');
            }

            let chips = '';
            balls.slice().reverse().forEach(b => { chips += MX.ball(MX.ballScore(b)); });

            const wickets = balls.filter(b => b.isWicket).length;
            const tone = over.totalRuns >= 12 ? ' is-big' : (wickets ? ' is-wkt' : '');

            rows += '<div class="mx-over' + tone + '">' +
                      '<div class="mx-over__left">' +
                        MX.crest(pane.abv, clr, 'mx-crest--xs') +
                        '<span class="mx-over__no">Ov ' + esc(over.overNumber) + '</span>' +
                        '<span class="mx-over__score">' + esc(over.totalInningRuns) + '-' +
                          esc(over.totalInningWickets) + '</span>' +
                      '</div>' +
                      '<div class="mx-over__mid">' +
                        '<div class="mx-over__who"><b>' + esc(bowler) + '</b> to ' +
                          MX.overBatsmen(over).map(esc).join(', ') + '</div>' +
                        '<div class="mx-over__balls">' + chips + '</div>' +
                      '</div>' +
                      '<div class="mx-over__right">' +
                        '<span class="mx-over__runs">' + esc(over.totalRuns) +
                          '<small>runs</small></span>' +
                      '</div>' +
                    '</div>';
        });

        html += '<div class="mx-card">' +
                  '<div class="mx-card__head mx-card__head--team" style="' + MX.tint(pane.abv, clr) + '">' +
                    '<span class="material-icons-round">' +
                      (pane.so ? 'bolt' : 'av_timer') + '</span>' +
                    esc(pane.label) + '<small>Newest first</small>' +
                  '</div>' + rows +
                '</div>';
    });

    document.getElementById('tab-content').innerHTML = html;
}

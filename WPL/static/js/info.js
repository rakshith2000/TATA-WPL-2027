/* ==========================================================================
   WPL 2027 · Match centre — Info panel
   Fixture card: the matchup, then the details the feed knows about it.
   Rendered by js/match.js, which supplies the shared helpers on window.MX.
   ========================================================================== */

function renderTabInfo(data) {
    var MX = window.MX;
    var dt1 = (data.dt1 || [{}])[0];
    var dt2 = data.dt2 || [];
    var dt3 = data.dt3 || {};
    var tid = data.tid || {};

    var esc = MX.esc;
    var teamA = dt1.Team_A || '';
    var teamB = dt1.Team_B || '';

    /* Date and time arrive as separate ISO fields; the time carries no date,
       so they are formatted independently rather than glued together. The
       date is built part by part — "2026-04-12" alone would be read as UTC
       midnight and slip a day west of Greenwich. */
    var ymd = String(dt1.Date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    var when = ymd ? new Date(+ymd[1], +ymd[2] - 1, +ymd[3]) : null;
    var time = dt1.Time ? new Date('1970-01-01T' + dt1.Time) : null;

    var dateStr = when && !isNaN(when)
        ? when.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : (dt2[2] || 'TBA');
    var timeStr = time && !isNaN(time)
        ? time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) + ' IST'
        : 'TBA';

    /* umpires come through as one comma-separated string: on-field pair,
       third umpire, then the fourth if the feed bothered */
    var umps = String(dt3.umpires || '').split(',').map(function (u) { return u.trim(); })
                                        .filter(Boolean);
    var onField = umps.slice(0, 2).join(', ') || 'TBA';
    var third = umps[2] || 'TBA';

    var toss = dt3.toss_won_by && tid[dt3.toss_won_by]
        ? '<b>' + esc(tid[dt3.toss_won_by][1]) + '</b> won the toss and chose to ' +
          esc(dt3.toss_decision || '—')
        : 'Toss not done yet';

    function row(icon, key, value, sub) {
        return '<div class="mx-info__row">' +
                 '<span class="material-icons-round">' + icon + '</span>' +
                 '<span><span class="mx-info__k">' + esc(key) + '</span>' +
                 '<span class="mx-info__v">' + value +
                 (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></span>' +
               '</div>';
    }

    var html = '';

    /* --- the matchup ---------------------------------------------------- */
    html += '<div class="mx-card">' +
              '<div class="mx-vs">' +
                '<div class="mx-vs__team">' + MX.crest(teamA, data.clr2 || data.clr, '') +
                  '<span class="mx-vs__name">' + esc(data.fn ? (data.fn[teamA] || teamA) : teamA) + '</span>' +
                '</div>' +
                '<span class="mx-vs__sep">VS</span>' +
                '<div class="mx-vs__team">' + MX.crest(teamB, data.clr2 || data.clr, '') +
                  '<span class="mx-vs__name">' + esc(data.fn ? (data.fn[teamB] || teamB) : teamB) + '</span>' +
                '</div>' +
              '</div>' +
            '</div>';

    /* --- the detail grid ------------------------------------------------ */
    html += '<div class="mx-card">' +
              '<div class="mx-card__head"><span class="material-icons-round">info</span>Match details</div>' +
              '<div class="mx-info">' +
                row('emoji_events', 'Match', esc(dt2[0] || dt1.Match_No || '—'),
                    'TATA Women\'s Premier League 2027') +
                row('event', 'Date', esc(dateStr), timeStr) +
                row('place', 'Venue', esc(dt1.Venue || dt2[1] || 'TBA')) +
                row('toll', 'Toss', toss) +
                row('sports', 'On-field umpires', esc(onField)) +
                row('videocam', 'Third umpire', esc(third)) +
                row('gavel', 'Match referee', esc(dt3.referee || 'TBA')) +
                row('live_tv', 'TV &amp; streaming', 'Star Sports Network', 'JioHotstar') +
              '</div>' +
            '</div>';

    document.getElementById('tab-content').innerHTML = html;
}

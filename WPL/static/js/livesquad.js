/* ==========================================================================
   WPL 2027 · Match centre — Squad panel
   Playing XI, substitutes and bench for both sides, laid out head to head.
   Before the toss only the wider squad is known, so that is what is shown.
   Shared helpers come from window.MX (js/match.js).
   ========================================================================== */

function Capitalize(str) {
    return String(str || '').split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

function renderTabSquad(data) {
    const MX = window.MX;
    const esc = MX.esc;
    const dt3 = data.dt3 || {};
    const tid = data.tid || {};
    const clr2 = data.clr2 || {};
    const squads = dt3.squad;

    if (!Array.isArray(squads) || squads.length < 2) {
        document.getElementById('tab-content').innerHTML =
            '<div class="mx-empty"><span class="material-icons-round">groups</span>' +
            '<b>Teams not announced</b><p>The XIs are published around the toss, half an hour before the start.</p></div>';
        return;
    }

    const teams = squads.slice(0, 2).map(s => (tid[s.team_id] || [])[0] || '');
    const named = (squads[0].players || []).length > 0;   /* has the toss happened? */

    /* A player is flagged as the impact sub coming in ([0]) or the one making
       way ([1]); the feed only fills this in once the change is made. */
    function impact(squad, player) {
        const ip = squad.impact_players;
        if (!ip || !ip.length) return '';
        if (ip[0] && player.name === ip[0].name) return 'in';
        if (ip[1] && player.name === ip[1].name) return 'out';
        return '';
    }

    function row(squad, player) {
        const team = player.team || 'NA';
        const swap = impact(squad, player);
        /* `delta` marks a change against the previously published XI */
        const changed = 'delta' in player ? (player.delta === 1 ? 'is-in' : 'is-out') : '';
        const mark = swap
            ? '<img src="/static/images/' + swap + '.png" alt="' + (swap === 'in' ? 'Impact sub in' : 'Replaced') + '">'
            : '';
        const abroad = player.overseas
            ? '<img src="/static/images/overseas2.png" alt="Overseas player" title="Overseas">'
            : '';

        return '<a class="mx-sq__row ' + changed + (team === 'NA' ? ' is-off' : '') + '" href="' +
                 MX.playerHref(team, player.name) + '">' +
                 MX.playerPic(team, player.name, 'mx-sq__pic', true) +
                 '<span class="mx-sq__meta">' +
                   '<span class="mx-sq__name">' + esc(player.name) +
                     (player.position === 'captain' ? '<span class="mx-sq__c">C</span>' : '') +
                     abroad + mark +
                   '</span>' +
                   '<span class="mx-sq__role">' + esc(Capitalize(String(player.role || '').replace('-', ' '))) + '</span>' +
                 '</span>' +
               '</a>';
    }

    function block(title, key) {
        const left = (squads[0][key] || []).map(p => row(squads[0], p)).join('');
        const right = (squads[1][key] || []).map(p => row(squads[1], p)).join('');
        if (!left && !right) return '';
        /* centred, because the title sits over two columns rather than one */
        return '<div class="mx-sub mx-sub--mid">' + esc(title) + '</div>' +
               '<div class="mx-sq">' +
                 '<div class="mx-sq__col">' + left + '</div>' +
                 '<div class="mx-sq__col mx-sq__col--r">' + right + '</div>' +
               '</div>';
    }

    let html = '<div class="mx-card">' +
                 '<div class="mx-sq__head">' +
                   '<span class="mx-sq__team">' + MX.crest(teams[0], clr2, 'mx-crest--sm') + esc(teams[0]) + '</span>' +
                   '<span class="mx-sq__team">' + esc(teams[1]) + MX.crest(teams[1], clr2, 'mx-crest--sm') + '</span>' +
                 '</div>';

    if (named) {
        html += block('Playing XI', 'players');
        html += block('Substitutes', 'substitute_players');
        html += block('Bench', 'bench_players');
    } else {
        html += block('Squad', 'bench_players');
    }

    html += '<div class="mx-sq__legend">' +
              '<span><span class="mx-sq__c">C</span>Captain</span>' +
              '<span><img src="/static/images/overseas2.png" alt="">Overseas</span>' +
              '<span><img src="/static/images/in.png" alt="">Impact player in</span>' +
              '<span><img src="/static/images/out.png" alt="">Replaced</span>' +
              '<span><i class="is-in"></i>Added since the last XI</span>' +
              '<span><i class="is-out"></i>Dropped since the last XI</span>' +
            '</div></div>';

    document.getElementById('tab-content').innerHTML = html;
}

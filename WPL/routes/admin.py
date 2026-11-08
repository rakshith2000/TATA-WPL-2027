"""Admin pages: adding a match result, removing one, and the manual overrides.

Every view here is behind @login_required. The update/delete pair are mirrors
of each other - whatever an up* writes, the matching del* takes back off - and
both re-stamp the standings rank and kick off a qualification refresh in the
background once the table has moved.
"""
import threading
from flask import render_template, request, redirect, url_for, flash
from flask_login import login_required
from sqlalchemy.sql import text

from .. import db
from ..main import main
from ..models import Pointstable, Fixture
from ..config import pofs, full_name, clr, LEAGUE_MATCHES
from ..services.playoffs import run_refresh_qualification_bg
from ..services.standings import update_rank_for_fixture, delete_rank_for_fixture
from ..services.results import (upMatchNormal, upMatchSuperOver, upMatchTied, upMatchAbandoned,
                                upMatchDLS, delMatchNormal, delMatchSuperOver, delMatchTied,
                                delMatchAbandoned, delMatchDLS)

# Everything an admin may name: the twenty league matches by number, and the two
# playoff ties by the label they are stored under. Read off config rather than
# written out, so a change of format is a change of config.json.
LEAGUE_NOS = list(range(1, LEAGUE_MATCHES + 1))
VALID_MATCHES = LEAGUE_NOS + list(pofs.values())
# The playoffs sort after the league in the order config.json lists them
PLAYOFF_ORDER = {label: LEAGUE_MATCHES + 1 + i for i, label in enumerate(pofs.values())}

def _overs_per_side(form):
    """How many overs each innings was entitled to: 20, or less if rain cut it.

    Only the completed and tied sections ask - a DLS result carries the revised
    allocation already. Five is the minimum a T20 can be reduced to and still
    count, and anything outside 5-20 is read as the full twenty rather than
    quietly booking an allocation the match cannot have had.
    """
    try:
        overs = float(form.get('overs_per_side') or 20)
    except (TypeError, ValueError):
        return 20
    return overs if 5 <= overs <= 20 else 20

def _revised(form, side):
    """What DLS credited one side with, and the target and overs it was set.

    The tied section shares the DLS panel with the DLS section, so the field
    names are the same ones upMatchDLS() reads.
    """
    return {'runsDLS': int(form.get('dls_runs' + side) or 0),
            'oversDLS': float(form.get('dls_overs' + side) or 0),
            'revTarget': int(form.get('dls_target') or 0),
            'revOvers': float(form.get('dls_overs') or 0)}

def _super_overs(form, side):
    """Every super over one side played, oldest first, off the update form.

    The super-over panel in updatematch.html is repeatable - a tied super over is
    replayed - and its blocks are numbered from 1 and renumbered on every add or
    remove, so they are walked until the next one is not there. Blank boxes come
    back as 0: the admin may well have only the runs for a two-ball super over.
    """
    innings = []
    n = 1
    while 'so{}_runs{}'.format(n, side) in form:
        innings.append({'runs': int(form['so{}_runs{}'.format(n, side)] or 0),
                        'overs': float(form['so{}_overs{}'.format(n, side)] or 0),
                        'wkts': int(form['so{}_wkts{}'.format(n, side)] or 0)})
        n += 1
    return innings

@main.route('/update')
@login_required
def update():
    FR = sorted(
        Fixture.query.all(),
        key=lambda r: (int(r.Match_No) if str(r.Match_No).isdigit()
                       else PLAYOFF_ORDER.get(r.Match_No, LEAGUE_MATCHES + 99))
    )

    key = request.args.get('key')

    return render_template('update.html', key=key, FR=FR)

@main.route('/updatematch', methods=['POST'])
@login_required
def updatematch():
    hint = request.form.get('hint')
    key = 1
    # Before: To render Update Input Web page
    if request.method == "POST" and hint == 'before':
        match = str(request.form.get('match')).upper()
        match = int(match) if match.isdigit() else pofs[match]
        FR = Fixture.query.filter_by(Match_No=str(match)).first()
        if match not in VALID_MATCHES:
            flash('Invalid Match number to update', category='error')
            return redirect(url_for('main.update', key=key))
        if FR.Win_T != None:
            flash('Result for Match {} already updated, delete to update it again'.format(match), category='warning')
            return redirect(url_for('main.update', key=key))
        if FR.Team_A == 'TBA' or FR.Team_B == 'TBA':
            flash('Teams are not updated for Playoff Match {} to update its result'.format(match), category='warning')
            return redirect(url_for('main.update', key=key))
        return render_template('updatematch.html', FR=FR, fn=full_name, match=match, clr=clr)
    
    # After: To update Match Result to Database
    if request.method == 'POST' and hint == 'after':
        matchStatus = request.form.get('match_status')
        if matchStatus == 'completed':
            data = {}
            overs = _overs_per_side(request.form)
            data['team_A'] = {'runs': int(request.form['runsA']), 'overs': float(request.form['oversA']), 'wkts': int(request.form['wktsA']), 'maxOvers': overs}
            data['team_B'] = {'runs': int(request.form['runsB']), 'overs': float(request.form['oversB']), 'wkts': int(request.form['wktsB']), 'maxOvers': overs}
            data['match'] = request.form['match']
            data['result'] = {'win_team': request.form['wt'], 'win_type': request.form['win_type'], 'win_by': request.form['win_by']}
            upMatchNormal(data)
        elif matchStatus == 'tied':
            data = {}
            overs = _overs_per_side(request.form)
            data['team_A'] = {'runs': int(request.form['tied_runsA']), 'overs': float(request.form['tied_oversA']), 'wkts': int(request.form['tied_wktsA']), 'maxOvers': overs, 'SO': _super_overs(request.form, 'A')}
            data['team_B'] = {'runs': int(request.form['tied_runsB']), 'overs': float(request.form['tied_oversB']), 'wkts': int(request.form['tied_wktsB']), 'maxOvers': overs, 'SO': _super_overs(request.form, 'B')}
            # a rain-shortened chase that still finishes level is tied against the
            # DLS par score, so the tied section can carry the revised figures too
            if request.form.get('tied_dls') == 'yes':
                data['team_A'].update(_revised(request.form, 'A'))
                data['team_B'].update(_revised(request.form, 'B'))
            data['match'] = request.form['match']
            if request.form.get('superover_outcome') == 'not_completed':
                # no super over was completed, so nobody won: a point each
                data['reason'] = request.form.get('tied_reason', '')
                upMatchTied(data)
            else:
                data['result'] = {'so_win_team': request.form['superover_winner'], 'so_win_type': request.form['superover_win_type'], 'so_win_by': request.form['superover_win_by']}
                upMatchSuperOver(data)
        elif matchStatus == 'abandoned':
            data = {}
            data['match'] = request.form['match']
            data['toss_status'] = request.form['abandon_toss_status']
            data['reason'] = request.form['abandon_reason']
            if data['toss_status'] == 'with_toss':
                data['team_A'] = {'runs': int(request.form['abandon_runsA']), 'overs': float(request.form['abandon_oversA']), 'wkts': int(request.form['abandon_wktsA'])}
                data['team_B'] = {'runs': int(request.form['abandon_runsB']), 'overs': float(request.form['abandon_oversB']), 'wkts': int(request.form['abandon_wktsB'])}
            upMatchAbandoned(data)
        elif matchStatus == 'interrupted_dls':
            data = {}
            data['team_A'] = {'runs': int(request.form['runsA']), 'overs': float(request.form['oversA']), 'wkts': int(request.form['wktsA']), 'runsDLS': int(request.form['dls_runsA']), 'oversDLS': float(request.form['dls_oversA']), 'revTarget': int(request.form['dls_target']), 'revOvers': float(request.form['dls_overs'])}
            data['team_B'] = {'runs': int(request.form['runsB']), 'overs': float(request.form['oversB']), 'wkts': int(request.form['wktsB']), 'runsDLS': int(request.form['dls_runsB']), 'oversDLS': float(request.form['dls_oversB']), 'revTarget': int(request.form['dls_target']), 'revOvers': float(request.form['dls_overs'])}
            data['dls_reason'] = request.form['dls_reason']
            data['match'] = request.form['match']
            data['result'] = {'win_team': request.form['wt'], 'win_type': request.form['win_type'], 'win_by': request.form['win_by'], 'dls_target': int(request.form['dls_target']), 'dls_overs': float(request.form['dls_overs'])}
            upMatchDLS(data)

        update_rank_for_fixture(data['match'])
        flash('Match {} result updated successfully'.format(data['match']), category='success')
        from run import app as flask_app
        threading.Thread(target=run_refresh_qualification_bg, args=(flask_app,)).start()
        return redirect(url_for('main.update', key=key))

@main.route('/deletematch', methods=['POST'])
@login_required
def deletematch():
    hint = request.form.get('hint')
    key = 2
    # Before: To render Delete Input Web page
    if request.method == "POST" and hint == 'before':
        dmatch = str(request.form.get('dmatch')).upper()
        dmatch = int(dmatch) if dmatch.isdigit() else pofs[dmatch]
        FR = Fixture.query.filter_by(Match_No=str(dmatch)).first()
        if dmatch not in VALID_MATCHES:
            flash('Invalid Match number to delete', category='error')
            return redirect(url_for('main.update', key=key))
        if FR.Win_T == None:
            flash('Result for Match {} is not yet updated to delete'.format(dmatch), category='warning')
            return redirect(url_for('main.update', key=key))
        return render_template('deletematch.html', FR=FR, fn=full_name, dmatch=dmatch, clr=clr)
    
    # After: To delete Match Result from Database
    if request.method == "POST" and hint == 'after':
        dmatch = request.form.get('dmatch')
        result = db.session.execute(text('SELECT "Result" FROM fixture WHERE "Match_No" = :match_no'),{'match_no': dmatch}).fetchall()
        res = result[0][0]
        data = {'match': dmatch}
        # Keyword order matters. "Match tied" comes first because the reason an
        # admin gives for an unfinished super over usually names it, and a tie
        # must not be unwound as a super-over win. "Super over" comes before
        # "DLS" for the same reason in reverse: a super over bowled after a
        # rain-revised chase names both, and it is the super-over result.
        if "Match tied" in res:
            delMatchTied(data)
        elif "Super over" in res:
            delMatchSuperOver(data)
        elif "Match abandoned" in res:
            delMatchAbandoned(data)
        elif "DLS" in res:
            delMatchDLS(data)
        else:
            delMatchNormal(data)

        delete_rank_for_fixture(dmatch)
        flash('Match {} result deleted successfully'.format(dmatch), category='success')
        from run import app as flask_app
        threading.Thread(target=run_refresh_qualification_bg, args=(flask_app,)).start()
        return redirect(url_for('main.update', key=key))

@main.route('/updatepotm', methods=['POST'])
@login_required
def updatepotm():
    hint = request.form.get('hint')
    key = 6
    if request.method == "POST" and hint == 'before':
        match = str(request.form.get('potmmatch')).upper()
        match = int(match) if match.isdigit() else pofs[match]
        FR = Fixture.query.filter_by(Match_No=str(match)).first()
        sq = db.session.execute(text('SELECT * FROM squad WHERE "Team" = :team_a OR "Team" = :team_b ORDER BY "Name"'),{'team_a': FR.Team_A, 'team_b': FR.Team_B}).fetchall()
        sq = [dict(row._mapping) for row in sq]
        if match not in VALID_MATCHES:
            flash('Invalid Match number to update potm', category='error')
            return redirect(url_for('main.update', key=key))
        return render_template('updatepotm.html', FR=FR, fn=full_name, match=match, sq=sq, clr=clr)
    if request.method == 'POST' and hint == 'after':
        match_no = request.form.get('match')
        potm = request.form.get('potm')
        potmteam = request.form.get('team')
        FR = Fixture.query.filter_by(Match_No=match_no).first()
        FR.POTM = {'name': potm, 'team': potmteam}
        db.session.commit()

        flash('POTM for match {} updated successfully'.format(match_no), category='success')
        return redirect(url_for('main.update', key=key))

@main.route('/updateplayoffs', methods=['POST'])
@login_required
def updateplayoffs():
    hint = request.form.get('hint')
    key = 3
    if request.method == "POST" and hint == 'before':
        pomatch = request.form.get('pomatch').upper()
        if pomatch not in list(pofs):
            flash('Invalid match, Select a valid Playoff Match', category='error')
            return redirect(url_for('main.update', key=key))
        FR = Fixture.query.filter_by(Match_No=pofs[pomatch]).first()
        return render_template('playoffsupdate.html', pomatch=pofs[pomatch], teams=full_name, FR=FR, clr=clr)
    if request.method == 'POST' and hint == 'after':
        pomatch = request.form.get('pomatch')
        FR = Fixture.query.filter_by(Match_No=pomatch).first()
        if request.form.get('checkA') == 'YES':
            FR.Team_A = request.form.get('teamA')
        if request.form.get('checkB') == 'YES':
            FR.Team_B = request.form.get('teamB')
        if request.form.get('checkV') == 'YES':
            FR.Venue = request.form.get('venue')
        db.session.commit()
        flash('{} Playoff teams updated successfully'.format(pomatch), category='success')
        return redirect(url_for('main.update', key=key))

@main.route('/updatequalification', methods=['POST'])
@login_required
def updatequalification():
    key = 4
    qteam = request.form.get('qteam')
    PT = Pointstable.query.filter_by(team_name=qteam).first()
    PT.qed = "Q"
    db.session.commit()
    flash('Updated Qualification status for {} successfully'.format(qteam), category='success')
    return redirect(url_for('main.update', key=key))

@main.route('/updateelimination', methods=['POST'])
@login_required
def updateelimination():
    key = 5
    eteam = request.form.get('eteam')
    PT = Pointstable.query.filter_by(team_name=eteam).first()
    PT.qed = "E"
    db.session.commit()
    flash('Updated Elimination status for {} successfully'.format(eteam), category='success')
    return redirect(url_for('main.update', key=key))

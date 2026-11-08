"""Writing a match result onto its fixture, and taking it off again.

Each up* writes the result line and the two innings onto the Fixture, then
hands off to the points-table half; the del* undoes both. League matches only
touch the points table - playoff fixtures have a non-numeric Match_No, which is
what the isdigit() guards test.

Five endings: a normal win, a tie the super over settled, a tie it could not,
an abandonment, and a DLS result. They are told apart afterwards by keywords in
the result line - "Match tied", "Super over", "Match abandoned", "DLS" - which
main.deletematch() and three templates read, so those words are load-bearing.

Every innings also carries the overs its side was entitled to, under 'maxOvers'
for a shortened match or 'revOvers' for a DLS one: a side bowled out has that
booked towards its net run rate rather than the overs it lasted, so a ten-over
game must not leave twenty against it. See pointstable._booked().

Result lines name the winner with full_name2 - the long "... Women" form - so
that what the site says matches what the live feed and the broadcast say.
"""
from .. import db
from ..models import Fixture
from ..config import full_name2
from .pointstable import (upPTNormal, upPTSuperOver, upPTTied, upPTAbandoned, upPTDLS,
                          delPTNormal, delPTSuperOver, delPTTied, delPTAbandoned, delPTDLS)

def _innings(score):
    """The innings as it goes onto the fixture: what was scored, and over how
    many overs the side was entitled to play."""
    kept = {'runs': score['runs'], 'overs': score['overs'], 'wkts': score['wkts'],
            'maxOvers': score.get('maxOvers') or 20}
    # a DLS-affected match also stores what the method credited the side with
    for key in ('runsDLS', 'oversDLS', 'revTarget', 'revOvers'):
        if score.get(key) is not None:
            kept[key] = score[key]
    return kept

def _dls_note(score):
    """"DLS method - Target 97 in 10 Ovrs", or nothing if the match was not one."""
    if not score.get('revTarget'):
        return ''
    return 'DLS method - Target {} in {} Ovrs'.format(score['revTarget'], score['revOvers'])

def upMatchNormal(data):
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    a, b = FR.Team_A, FR.Team_B
    FR.Result = '{} won by {} {}'.format(full_name2[data['result']['win_team']], data['result']['win_by'], data['result']['win_type'])
    FR.Win_T = data['result']['win_team']
    FR.A_info, FR.B_info = _innings(data['team_A']), _innings(data['team_B'])
    db.session.commit()
    if data['match'].isdigit():
        upPTNormal(a, data['team_A'], data['team_B'], data['match'], data['result']['win_team'])
        upPTNormal(b, data['team_B'], data['team_A'], data['match'], data['result']['win_team'])

def _tied_innings(data):
    """Both sides' tied innings plus their super overs, ready for the fixture."""
    out = []
    for side in ('team_A', 'team_B'):
        inn = _innings(data[side])
        inn['SO'] = data[side].get('SO') or []
        out.append(inn)
    return out

def upMatchSuperOver(data):
    """A tied match and the super over - or super overs - that settled it.

    A tied super over is replayed, so the two sides' super overs are stored as a
    list under 'SO' and read back through utils.formatting.super_overs(). Only the
    last one produced a result, so the margin in the result line is that one's;
    how many it took, and a revised target if rain had already shortened the
    chase, follow the margin rather than leading it - pages.py reads the margin
    back out as the first number in this string.

    The points table takes the tied innings alone - super over runs count towards
    neither the totals nor net run rate - so upPTSuperOver() books what the match
    proper came to, DLS-adjusted where the method applied.
    """
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    a, b = FR.Team_A, FR.Team_B
    rounds = max(len(data['team_A'].get('SO') or []), len(data['team_B'].get('SO') or []))
    notes = [n for n in (_dls_note(data['team_A']),
                         'after {} Super overs'.format(rounds) if rounds > 1 else '') if n]
    FR.Result = '{} won Super over by {} {}'.format(full_name2[data['result']['so_win_team']], data['result']['so_win_by'], data['result']['so_win_type'])
    if notes:
        FR.Result += ' ({})'.format('; '.join(notes))
    FR.Win_T = data['result']['so_win_team']
    FR.A_info, FR.B_info = _tied_innings(data)
    db.session.commit()
    if data['match'].isdigit():
        upPTSuperOver(a, data['team_A'], data['team_B'], data['match'], data['result']['so_win_team'])
        upPTSuperOver(b, data['team_B'], data['team_A'], data['match'], data['result']['so_win_team'])

def upMatchTied(data):
    """A tie the super over could not settle, so the sides share the points.

    The playing conditions replay a tied super over until one of them produces a
    result; if none can be bowled or completed - rain again, or the ground has to
    be handed back - the match stands as a tie and the teams take a point each.

    That is what a no result pays, and the points table has no tied column, so
    upPTTied() books it through the no-result columns. Unlike an abandonment the
    two innings were played out, so they do count towards net run rate.

    "Match tied" leads the result line and is the keyword the rest of the app
    tells this apart by. It has to, because the reason an admin types is very
    likely to mention the super over, and the super-over branches must not pick
    this up: main.deletematch() tests for "Match tied" first, and the fixture
    cards ask whether Win_T is 'NA' before laying out super-over scores.
    """
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    a, b = FR.Team_A, FR.Team_B
    notes = [n for n in ((data.get('reason') or '').strip(), _dls_note(data['team_A'])) if n]
    FR.Result = 'Match tied' + (' ({})'.format('; '.join(notes)) if notes else '')
    FR.Win_T = 'NA'
    FR.A_info, FR.B_info = _tied_innings(data)
    db.session.commit()
    if data['match'].isdigit():
        upPTTied(a, data['team_A'], data['team_B'], data['match'])
        upPTTied(b, data['team_B'], data['team_A'], data['match'])

def upMatchAbandoned(data):
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    a, b = FR.Team_A, FR.Team_B
    FR.Result = 'No result (Match abandoned due to {} - without toss)'.format(data['reason']) if data['toss_status'] == 'without_toss' else 'No result (Match abandoned due to {})'.format(data['reason'])
    FR.Win_T = "NA"
    FR.A_info = {'runs':0, 'overs':0.0, 'wkts':0} if data['toss_status'] == 'without_toss' else data['team_A']
    FR.B_info = {'runs':0, 'overs':0.0, 'wkts':0} if data['toss_status'] == 'without_toss' else data['team_B']
    db.session.commit()
    if data['match'].isdigit():
        upPTAbandoned(a, data['match'], data['toss_status'])
        upPTAbandoned(b, data['match'], data['toss_status'])

def upMatchDLS(data):
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    a, b = FR.Team_A, FR.Team_B
    FR.Result = '{} won by {} {} (DLS method - Target {} in {} Ovrs)'.format(full_name2[data['result']['win_team']], data['result']['win_by'], data['result']['win_type'], data['result']['dls_target'], data['result']['dls_overs'])
    FR.Win_T = data['result']['win_team']
    FR.A_info, FR.B_info = _innings(data['team_A']), _innings(data['team_B'])
    db.session.commit()
    if data['match'].isdigit():
        upPTDLS(a, data['team_A'], data['team_B'], data['match'], data['result']['win_team'])
        upPTDLS(b, data['team_B'], data['team_A'], data['match'], data['result']['win_team'])

def delMatchNormal(data):
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    if data['match'].isdigit():
        a, b = FR.Team_A, FR.Team_B
        delPTNormal(a, FR.A_info, FR.B_info, data['match'], FR.Win_T)
        delPTNormal(b, FR.B_info, FR.A_info, data['match'], FR.Win_T)
    FR.Result = None
    FR.Win_T = None
    FR.A_info = {'runs':0, 'overs':0.0, 'wkts':0}
    FR.B_info = {'runs':0, 'overs':0.0, 'wkts':0}
    db.session.commit()

def delMatchSuperOver(data):
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    if data['match'].isdigit():
        a, b = FR.Team_A, FR.Team_B
        delPTSuperOver(a, FR.A_info, FR.B_info, data['match'], FR.Win_T)
        delPTSuperOver(b, FR.B_info, FR.A_info, data['match'], FR.Win_T)
    FR.Result = None
    FR.Win_T = None
    FR.A_info = {'runs':0, 'overs':0.0, 'wkts':0}
    FR.B_info = {'runs':0, 'overs':0.0, 'wkts':0}
    db.session.commit()

def delMatchTied(data):
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    if data['match'].isdigit():
        a, b = FR.Team_A, FR.Team_B
        delPTTied(a, FR.A_info, FR.B_info, data['match'])
        delPTTied(b, FR.B_info, FR.A_info, data['match'])
    FR.Result = None
    FR.Win_T = None
    FR.A_info = {'runs':0, 'overs':0.0, 'wkts':0}
    FR.B_info = {'runs':0, 'overs':0.0, 'wkts':0}
    db.session.commit()

def delMatchAbandoned(data):
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    if data['match'].isdigit():
        a, b = FR.Team_A, FR.Team_B
        delPTAbandoned(a, data['match'])
        delPTAbandoned(b, data['match'])
    FR.Result = None
    FR.Win_T = None
    FR.A_info = {'runs':0, 'overs':0.0, 'wkts':0}
    FR.B_info = {'runs':0, 'overs':0.0, 'wkts':0}
    db.session.commit()

def delMatchDLS(data):
    FR = Fixture.query.filter_by(Match_No=str(data['match'])).first()
    if data['match'].isdigit():
        a, b = FR.Team_A, FR.Team_B
        delPTDLS(a, FR.A_info, FR.B_info, data['match'], FR.Win_T)
        delPTDLS(b, FR.B_info, FR.A_info, data['match'], FR.Win_T)
    FR.Result = None
    FR.Win_T = None
    FR.A_info = {'runs':0, 'overs':0.0, 'wkts':0}
    FR.B_info = {'runs':0, 'overs':0.0, 'wkts':0}
    db.session.commit()

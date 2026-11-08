"""Applying and reversing one match's effect on the points table.

Five match endings, each with an up* that adds the result and a del* that takes
it back off again, so deleting a result returns the table to exactly where it
was. Net run rate is recomputed from the running For/Against totals each time.
"""
import json

from sqlalchemy.sql import text

from .. import db
from ..models import Pointstable
from ..utils.overs import oversAdd, oversSub, ovToPer

def _jsn(value):
    """A For/Against column as a dict, whichever driver read it.

    These rows come back from a raw text() SELECT, so SQLAlchemy does not know
    the column is JSON and cannot deserialise it. Postgres hands JSONB back as
    a dict either way; SQLite hands back the text it stored, which then indexes
    as a string and fails. Decoding here keeps one code path for both.
    """
    if isinstance(value, str):
        return json.loads(value)
    return value or {'runs': 0, 'overs': 0.0}

def _booked(score):
    """The runs and overs one innings puts into a side's For or Against.

    Two rules, and every ending needs both:

    · A DLS match books the revised figures, because those are what the method
      settled it on. Everything else books the innings as it was played.
    · A side that was bowled out is credited with the whole allocation its
      innings was entitled to rather than the overs it lasted - the IPL's own
      net run rate rule. That allocation is 20 unless rain shortened the match,
      which is why it is stored per fixture: a side all out inside a ten-over
      game must not have twenty overs booked against its run rate.

    Rows written before the allocation was recorded carry neither figure and
    fall back to 20, which is what they were entered as.
    """
    allocation = score.get('revOvers') or score.get('maxOvers') or 20
    if score.get('runsDLS') is not None:
        runs, overs = score['runsDLS'], score['oversDLS']
    else:
        runs, overs = score['runs'], score['overs']
    return runs, (allocation if score.get('wkts') == 10 else overs)

def upPTNormal(team, teamScore, teamScoreOpp, match, win_team):
    forRuns, forOvers = _booked(teamScore)
    againstRuns, againstOvers = _booked(teamScoreOpp)
    teamPT = db.session.execute(text('SELECT team_name, "P", "W", "L", "Points", "For", "Against", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        if i[0] == win_team:
            P, W, L, Points = 1 + i[1], 1 + i[2], 0 + i[3], 2 + i[4]
            wl = eval(i[7])
            wl[int(match)] = 'W'
            wl = dict(sorted(wl.items()))
        else:
            P, W, L, Points = 1 + i[1], 0 + i[2], 1 + i[3], 0 + i[4]
            wl = eval(i[7])
            wl[int(match)] = 'L'
            wl = dict(sorted(wl.items()))
        For = {'runs': _jsn(i[5])['runs'] + forRuns, 'overs': oversAdd(_jsn(i[5])['overs'], forOvers)}
        Against = {'runs': _jsn(i[6])['runs'] + againstRuns, 'overs': oversAdd(_jsn(i[6])['overs'], againstOvers)}
        NRR = round((For['runs'] / ovToPer(For['overs']) - Against['runs'] / ovToPer(Against['overs'])), 3)
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.W, PT.L, PT.Points, PT.NRR, PT.Win_List, PT.For, PT.Against = P, W, L, Points, NRR, str(wl), For, Against
    db.session.commit()

def upPTSuperOver(team, teamScore, teamScoreOpp, match, so_win_team):
    forRuns, forOvers = _booked(teamScore)
    againstRuns, againstOvers = _booked(teamScoreOpp)
    teamPT = db.session.execute(text('SELECT team_name, "P", "W", "L", "Points", "For", "Against", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        if i[0] == so_win_team:
            P, W, L, Points = 1 + i[1], 1 + i[2], 0 + i[3], 2 + i[4]
            wl = eval(i[7])
            wl[int(match)] = 'W'
            wl = dict(sorted(wl.items()))
        else:
            P, W, L, Points = 1 + i[1], 0 + i[2], 1 + i[3], 0 + i[4]
            wl = eval(i[7])
            wl[int(match)] = 'L'
            wl = dict(sorted(wl.items()))
        For = {'runs': _jsn(i[5])['runs'] + forRuns, 'overs': oversAdd(_jsn(i[5])['overs'], forOvers)}
        Against = {'runs': _jsn(i[6])['runs'] + againstRuns, 'overs': oversAdd(_jsn(i[6])['overs'], againstOvers)}
        NRR = round((For['runs'] / ovToPer(For['overs']) - Against['runs'] / ovToPer(Against['overs'])), 3)
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.W, PT.L, PT.Points, PT.NRR, PT.Win_List, PT.For, PT.Against = P, W, L, Points, NRR, str(wl), For, Against
    db.session.commit()

def upPTTied(team, teamScore, teamScoreOpp, match):
    """A tie the super over could not settle: a point each, and no W or L.

    The points table has no tied column, so this books the point the way a no
    result does - P and NR up one, one point - but the two innings were played
    to a finish, so unlike an abandonment they do count towards net run rate.
    """
    forRuns, forOvers = _booked(teamScore)
    againstRuns, againstOvers = _booked(teamScoreOpp)
    teamPT = db.session.execute(text('SELECT team_name, "P", "NR", "Points", "For", "Against", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        P, NR, Points = 1 + i[1], 1 + i[2], 1 + i[3]
        wl = eval(i[6])
        wl[int(match)] = 'D'
        wl = dict(sorted(wl.items()))
        For = {'runs': _jsn(i[4])['runs'] + forRuns, 'overs': oversAdd(_jsn(i[4])['overs'], forOvers)}
        Against = {'runs': _jsn(i[5])['runs'] + againstRuns, 'overs': oversAdd(_jsn(i[5])['overs'], againstOvers)}
        NRR = round((For['runs'] / ovToPer(For['overs']) - Against['runs'] / ovToPer(Against['overs'])), 3)
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.NR, PT.Points, PT.NRR, PT.Win_List, PT.For, PT.Against = P, NR, Points, NRR, str(wl), For, Against
    db.session.commit()

def upPTAbandoned(team, match, toss_status):
    teamPT = db.session.execute(text('SELECT team_name, "P", "NR", "Points", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        P, NR, Points = 1 + i[1], 1 + i[2], 1 + i[3]
        wl = eval(i[4])
        wl[int(match)] = 'D'
        wl = dict(sorted(wl.items()))
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.NR, PT.Points, PT.Win_List = P, NR, Points, str(wl)
    db.session.commit()

def upPTDLS(team, teamScore, teamScoreOpp, match, win_team):
    forRuns, forOvers = _booked(teamScore)
    againstRuns, againstOvers = _booked(teamScoreOpp)
    teamPT = db.session.execute(text('SELECT team_name, "P", "W", "L", "Points", "For", "Against", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        if i[0] == win_team:
            P, W, L, Points = 1 + i[1], 1 + i[2], 0 + i[3], 2 + i[4]
            wl = eval(i[7])
            wl[int(match)] = 'W'
            wl = dict(sorted(wl.items()))
        else:
            P, W, L, Points = 1 + i[1], 0 + i[2], 1 + i[3], 0 + i[4]
            wl = eval(i[7])
            wl[int(match)] = 'L'
            wl = dict(sorted(wl.items()))
        For = {'runs': _jsn(i[5])['runs'] + forRuns, 'overs': oversAdd(_jsn(i[5])['overs'], forOvers)}
        Against = {'runs': _jsn(i[6])['runs'] + againstRuns, 'overs': oversAdd(_jsn(i[6])['overs'], againstOvers)}
        NRR = round((For['runs'] / ovToPer(For['overs']) - Against['runs'] / ovToPer(Against['overs'])), 3)
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.W, PT.L, PT.Points, PT.NRR, PT.Win_List, PT.For, PT.Against = P, W, L, Points, NRR, str(wl), For, Against
    db.session.commit()

def delPTNormal(team, teamScore, teamScoreOpp, match, win_team):
    forRuns, forOvers = _booked(teamScore)
    againstRuns, againstOvers = _booked(teamScoreOpp)
    teamPT = db.session.execute(text('SELECT team_name, "P", "W", "L", "Points", "For", "Against", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        if i[0] == win_team:
            P, W, L, Points = -1 + i[1], -1 + i[2], 0 + i[3], -2 + i[4]
            wl = eval(i[7])
            del wl[int(match)]
            wl = dict(sorted(wl.items()))
        else:
            P, W, L, Points = -1 + i[1], 0 + i[2], -1 + i[3], 0 + i[4]
            wl = eval(i[7])
            del wl[int(match)]
            wl = dict(sorted(wl.items()))
        For = {'runs': _jsn(i[5])['runs'] - forRuns, 'overs': oversSub(_jsn(i[5])['overs'], forOvers)}
        Against = {'runs': _jsn(i[6])['runs'] - againstRuns, 'overs': oversSub(_jsn(i[6])['overs'], againstOvers)}
        if ovToPer(For['overs']) == 0 or ovToPer(Against['overs']) == 0:
            NRR = 0.0
        else:
            NRR = round((For['runs'] / ovToPer(For['overs']) - Against['runs'] / ovToPer(Against['overs'])), 3)
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.W, PT.L, PT.Points, PT.NRR, PT.Win_List, PT.For, PT.Against = P, W, L, Points, NRR, str(wl), For, Against
    db.session.commit()

def delPTSuperOver(team, teamScore, teamScoreOpp, match, so_win_team):
    forRuns, forOvers = _booked(teamScore)
    againstRuns, againstOvers = _booked(teamScoreOpp)
    teamPT = db.session.execute(text('SELECT team_name, "P", "W", "L", "Points", "For", "Against", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        if i[0] == so_win_team:
            P, W, L, Points = -1 + i[1], -1 + i[2], 0 + i[3], -2 + i[4]
            wl = eval(i[7])
            del wl[int(match)]
            wl = dict(sorted(wl.items()))
        else:
            P, W, L, Points = -1 + i[1], 0 + i[2], -1 + i[3], 0 + i[4]
            wl = eval(i[7])
            del wl[int(match)]
            wl = dict(sorted(wl.items()))
        For = {'runs': _jsn(i[5])['runs'] - forRuns, 'overs': oversSub(_jsn(i[5])['overs'], forOvers)}
        Against = {'runs': _jsn(i[6])['runs'] - againstRuns, 'overs': oversSub(_jsn(i[6])['overs'], againstOvers)}
        if ovToPer(For['overs']) == 0 or ovToPer(Against['overs']) == 0:
            NRR = 0.0
        else:
            NRR = round((For['runs'] / ovToPer(For['overs']) - Against['runs'] / ovToPer(Against['overs'])), 3)
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.W, PT.L, PT.Points, PT.NRR, PT.Win_List, PT.For, PT.Against = P, W, L, Points, NRR, str(wl), For, Against
    db.session.commit()

def delPTTied(team, teamScore, teamScoreOpp, match):
    """Reverse upPTTied(): the point back off, and the innings out of For/Against."""
    forRuns, forOvers = _booked(teamScore)
    againstRuns, againstOvers = _booked(teamScoreOpp)
    teamPT = db.session.execute(text('SELECT team_name, "P", "NR", "Points", "For", "Against", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        P, NR, Points = -1 + i[1], -1 + i[2], -1 + i[3]
        wl = eval(i[6])
        del wl[int(match)]
        wl = dict(sorted(wl.items()))
        For = {'runs': _jsn(i[4])['runs'] - forRuns, 'overs': oversSub(_jsn(i[4])['overs'], forOvers)}
        Against = {'runs': _jsn(i[5])['runs'] - againstRuns, 'overs': oversSub(_jsn(i[5])['overs'], againstOvers)}
        if ovToPer(For['overs']) == 0 or ovToPer(Against['overs']) == 0:
            NRR = 0.0
        else:
            NRR = round((For['runs'] / ovToPer(For['overs']) - Against['runs'] / ovToPer(Against['overs'])), 3)
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.NR, PT.Points, PT.NRR, PT.Win_List, PT.For, PT.Against = P, NR, Points, NRR, str(wl), For, Against
    db.session.commit()

def delPTAbandoned(team, match):
    teamPT = db.session.execute(text('SELECT team_name, "P", "NR", "Points", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        P, NR, Points = -1 + i[1], -1 + i[2], -1 + i[3]
        wl = eval(i[4])
        del wl[int(match)]
        wl = dict(sorted(wl.items()))
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.NR, PT.Points, PT.Win_List = P, NR, Points, str(wl)
    db.session.commit()

def delPTDLS(team, teamScore, teamScoreOpp, match, win_team):
    forRuns, forOvers = _booked(teamScore)
    againstRuns, againstOvers = _booked(teamScoreOpp)
    teamPT = db.session.execute(text('SELECT team_name, "P", "W", "L", "Points", "For", "Against", "Win_List" FROM pointstable WHERE team_name = :team_name'),{'team_name': str(team)}).fetchall()
    for i in teamPT:
        if i[0] == win_team:
            P, W, L, Points = -1 + i[1], -1 + i[2], 0 + i[3], -2 + i[4]
            wl = eval(i[7])
            del wl[int(match)]
            wl = dict(sorted(wl.items()))
        else:
            P, W, L, Points = -1 + i[1], 0 + i[2], -1 + i[3], 0 + i[4]
            wl = eval(i[7])
            del wl[int(match)]
            wl = dict(sorted(wl.items()))
        For = {'runs': _jsn(i[5])['runs'] - forRuns, 'overs': oversSub(_jsn(i[5])['overs'], forOvers)}
        Against = {'runs': _jsn(i[6])['runs'] - againstRuns, 'overs': oversSub(_jsn(i[6])['overs'], againstOvers)}
        if ovToPer(For['overs']) == 0 or ovToPer(Against['overs']) == 0:
            NRR = 0.0
        else:
            NRR = round((For['runs'] / ovToPer(For['overs']) - Against['runs'] / ovToPer(Against['overs'])), 3)
        PT = Pointstable.query.filter_by(team_name=str(i[0])).first()
        PT.P, PT.W, PT.L, PT.Points, PT.NRR, PT.Win_List, PT.For, PT.Against = P, W, L, Points, NRR, str(wl), For, Against
    db.session.commit()

"""The match centre shell and the tab it should open on."""
from datetime import datetime, timedelta
from flask import render_template, request, redirect, url_for
from sqlalchemy.sql import text

from .. import db
from ..main import main
from ..config import full_name, clr, sqclr
from ..utils.dates import tz, start_DT

@main.route('/match-<match>')
def match(match):
    """Match centre: the shell around the live feed.

    Everything that moves is fetched by js/match.js from /api/match-<no>/...,
    but the fixture itself is known here, so the header and the matchup are
    rendered server side - the page is useful before the first poll lands.
    """
    MatchDT = db.session.execute(text('SELECT * FROM Fixture WHERE "Match_No" = :matchno'),
                                 {'matchno': match}).fetchall()
    MatchDT = MatchDT[0]
    source = request.args.get('source', None)
    team = request.args.get('fteam', None)
    return render_template('match.html', match=match, source=source, fteam=team, matchDT=MatchDT,
                           start=start_DT(MatchDT.Date, MatchDT.Time),
                           fn=full_name, clr=clr, sqclr=sqclr)

@main.route('/match-<match>/FRScore')
def FRScore(match):
    MatchFR = db.session.execute(text('SELECT * FROM Fixture WHERE "Match_No" = :matchno'),
                                 {'matchno': match}).fetchall()
    MatchFR = MatchFR[0]
    matchDT = start_DT(MatchFR.Date, MatchFR.Time)
    current_date = datetime.now(tz)
    current_date = current_date.replace(tzinfo=None)
    source = request.args.get('source', None)
    team = request.args.get('fteam', None)
    if current_date < (matchDT - timedelta(minutes=30)):
        return redirect(url_for('main.match', tab='matchInfo', match=match, source=source, fteam=team))
    elif current_date >= (matchDT - timedelta(minutes=30)) and MatchFR[10] is None:
        return redirect(url_for('main.match', tab='liveScore', match=match, source=source, fteam=team))
    elif MatchFR[10] is not None:
        return redirect(url_for('main.match', tab='scoreCard', match=match, source=source, fteam=team))

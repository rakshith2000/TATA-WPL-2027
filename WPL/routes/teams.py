"""The franchise directory, one team's squad, and one player's page."""
from datetime import datetime
from flask import render_template, request

from ..main import main
from ..models import Pointstable, Fixture, Squad
from ..config import full_name, champions, teams_data, teams_social, clr, ptclr, sqclr
from ..utils.dates import tz, calculate_age
from ..services.standings import getRanksForPT, getNextOpponents
from ..services.player_stats import get_player_stats
from ..services.player_stats_stub import stub_player_stats
from .. import db

@main.route('/teams')
def teams():
    """Franchise directory: honours, squad make-up and this season's form.

    The season numbers on a team card have to agree with the standings page,
    so they come from the same source in the same order - Pointstable, keyed
    by team abbreviation with its display position attached.
    """
    dataPT = Pointstable.query.order_by(Pointstable.Points.desc(), Pointstable.W.desc(),
                                        Pointstable.NRR.desc(), Pointstable.id.asc()).all()
    standings = {}
    for index, i in enumerate(dataPT):
        wl = list(eval(i.Win_List).values()) if i.Win_List else []
        standings[i.team_name] = {
            'pos': index + 1, 'P': i.P, 'W': i.W, 'L': i.L, 'NR': i.NR,
            'Pts': i.Points, 'NRR': i.NRR, 'qed': i.qed,
            'form': ''.join(wl[-5:])
        }

    # Squad make-up, in one pass over the table rather than ten count queries
    squads = {t: {'total': 0, 'overseas': 0} for t in teams_data}
    for team, overseas in db.session.query(Squad.Team, Squad.Overseas).all():
        if team in squads:
            squads[team]['total'] += 1
            if overseas == 'Y':
                squads[team]['overseas'] += 1

    finalsData = Fixture.query.filter(Fixture.Match_No == 'Final').first()
    return render_template('teams.html', fn=full_name, champions=champions, clr=ptclr,
                           sqclr=sqclr, mclr=clr, td=teams_data, st=standings, squads=squads,
                           ranks=getRanksForPT(),
                           nxt=getNextOpponents([i.team_name for i in dataPT]),
                           champion=finalsData.Win_T if finalsData else None)

@main.route('/teams/<team>')
def squad(team):
    """One franchise: honours, this season's form, official channels and the squad."""
    sq = Squad.query.filter_by(Team=team).order_by(Squad.Name).all()
    # captain first inside whichever role block he belongs to, the rest alphabetical
    sq = sorted(sq, key=lambda p: (p.Captain != 'Y', p.Name or ''))

    current_date = datetime.now(tz).replace(tzinfo=None)
    ages = {p.id: current_date.year - p.DOB.year -
                  ((current_date.month, current_date.day) < (p.DOB.month, p.DOB.day))
            for p in sq if p.DOB}

    # The hero carries the same season line as the standings page, so it has to
    # come from the same query in the same order.
    dataPT = Pointstable.query.order_by(Pointstable.Points.desc(), Pointstable.W.desc(),
                                        Pointstable.NRR.desc(), Pointstable.id.asc()).all()
    st = None
    for index, i in enumerate(dataPT):
        if i.team_name != team:
            continue
        wl = list(eval(i.Win_List).values()) if i.Win_List else []
        st = {'pos': index + 1, 'P': i.P, 'W': i.W, 'L': i.L, 'NR': i.NR, 'Pts': i.Points,
              'NRR': i.NRR, 'qed': i.qed, 'form': ''.join(wl[-5:]),
              'played': sum(j.P for j in dataPT)}

    finalsData = Fixture.query.filter(Fixture.Match_No == 'Final').first()
    return render_template('squad.html', team=team, sq=sq, fn=full_name, clr=clr, sqclr=sqclr,
                           td=teams_data, champions=champions, ages=ages, st=st,
                           social=teams_social.get(team, {}),
                           nxt=getNextOpponents([team]).get(team, '--'),
                           champion=finalsData.Win_T if finalsData else None)

@main.route('/team-<team>/squad_details/<name>')
def squad_details(team, name):
    sq = Squad.query.filter_by(Name=name).first()
    current_date = datetime.now(tz)
    current_date = current_date.replace(tzinfo=None)
    age = calculate_age(sq.DOB, current_date)
    # ?stats=<fixture> (or STUB_PLAYER_STATS) serves canned data while the feed
    # is down; falls through to the feed whenever neither is in play.
    stats = stub_player_stats(request.args.get('stats'), sq.Role, sq.URL_ID)
    if stats is None:
        # The WPL record is scraped from the player's own profile page rather
        # than fetched by id, so this takes the stored URL.
        stats = get_player_stats(sq.Player_URL)

    # Team-mates in the order the squad page lists them, so the prev/next arrows
    # walk the squad the same way the reader just saw it. Wraps at both ends.
    mates = sorted(Squad.query.filter_by(Team=team).order_by(Squad.Name).all(),
                   key=lambda p: (p.Captain != 'Y', p.Name or ''))
    here = next((i for i, p in enumerate(mates) if p.id == sq.id), None)
    step = (lambda d: mates[(here + d) % len(mates)]) if here is not None and len(mates) > 1 else (lambda d: None)

    # clr/sqclr go through whole: the shared points.html colour macros take the
    # full maps, not one team's slice.
    return render_template('squad_details.html', sq=sq, team=team, age=age, stats=stats,
                           fn=full_name, clr=clr, sqclr=sqclr,
                           prev_p=step(-1), next_p=step(1),
                           squad_n=len(mates), squad_i=(here + 1) if here is not None else 0)

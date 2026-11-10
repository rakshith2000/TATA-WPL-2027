"""The standings, fixtures and home pages."""
import re
from datetime import datetime
from flask import render_template, request
from sqlalchemy.sql import text

from .. import db
from ..main import main
from ..models import Pointstable, Fixture, Toppers
from ..config import full_name, clr, sqclr, TEAMS
from ..utils.dates import tz, start_DT
from ..services.standings import getRanksForPT, getNextOpponents


def _homepage_records(fixtures):
    """Derive compact season records from result data already stored locally."""
    completed = [fx for fx in fixtures if fx.Win_T is not None
                 and 'abandoned' not in (fx.Result or '').lower()]
    totals = []
    margins = []
    successful_chases = []
    successful_defends = []

    def match_card(fx):
        def score(info):
            info = info if isinstance(info, dict) else {}
            try:
                runs = int(info.get('runs') or 0)
                wickets = int(info.get('wkts') or 0)
                overs = float(info.get('overs') or 0)
            except (TypeError, ValueError):
                runs, wickets, overs = 0, 0, 0.0
            score_display = str(runs) if wickets == 10 else f'{runs}/{wickets}'
            return {'runs': runs, 'wickets': wickets, 'overs': f'{overs:.1f}',
                    'display': score_display}

        return {
            'match': fx.Match_No,
            'team_a': fx.Team_A,
            'team_b': fx.Team_B,
            'winner': fx.Win_T,
            'score_a': score(fx.A_info),
            'score_b': score(fx.B_info),
        }

    for fx in completed:
        card = match_card(fx)
        for side, opponent, info in (
                (fx.Team_A, fx.Team_B, fx.A_info),
                (fx.Team_B, fx.Team_A, fx.B_info)):
            runs = info.get('runs', 0) if isinstance(info, dict) else 0
            try:
                runs = int(runs or 0)
            except (TypeError, ValueError):
                runs = 0
            if runs > 0:
                totals.append({'team': side, 'opponent': opponent, 'runs': runs,
                               'match': fx.Match_No, 'scorecard': card})

        result = fx.Result or ''
        if fx.Win_T in TEAMS and 'super over' not in result.lower():
            margin = re.search(r'won by\s+(\d+)\s+(runs?|wickets?)\b', result, re.I)
            if margin:
                value = int(margin.group(1))
                unit = 'runs' if margin.group(2).lower().startswith('run') else 'wickets'
                record = {'value': value, 'unit': unit, 'winner': fx.Win_T,
                          'match': fx.Match_No, 'scorecard': card}
                margins.append(record)

                if unit == 'wickets':
                    winning_score = card['score_a' if fx.Win_T == fx.Team_A else 'score_b']
                    target = fx.B_info if fx.Win_T == fx.Team_A else fx.A_info
                    target_runs = target.get('runs', 0) if isinstance(target, dict) else 0
                    try:
                        target_runs = int(target_runs or 0)
                    except (TypeError, ValueError):
                        target_runs = 0
                    dls_target = re.search(r'\bTarget\s+(\d+)', result, re.I)
                    successful_chases.append({
                        'team': fx.Win_T,
                        'runs': winning_score['runs'],
                        'target': int(dls_target.group(1)) if dls_target else target_runs + 1,
                        'match': fx.Match_No,
                        'scorecard': card,
                    })
                else:
                    winning_info = fx.A_info if fx.Win_T == fx.Team_A else fx.B_info
                    defended_runs = winning_info.get('runs', 0) if isinstance(winning_info, dict) else 0
                    try:
                        defended_runs = int(defended_runs or 0)
                    except (TypeError, ValueError):
                        defended_runs = 0
                    if defended_runs > 0:
                        successful_defends.append({
                            'team': fx.Win_T, 'runs': defended_runs,
                            'match': fx.Match_No, 'scorecard': card,
                        })

    ordered = sorted(completed, key=lambda fx: start_DT(fx.Date, fx.Time))
    streaks = {team: 0 for team in TEAMS}
    winning_streak_matches = {team: [] for team in TEAMS}
    best_streak = None
    losing_streaks = {team: 0 for team in TEAMS}
    losing_streak_matches = {team: [] for team in TEAMS}
    worst_streak = None
    for fx in ordered:
        sides = (fx.Team_A, fx.Team_B)
        if fx.Win_T in TEAMS:
            for team in sides:
                if team not in streaks:
                    continue
                if fx.Win_T == team:
                    streaks[team] += 1
                    winning_streak_matches[team].append(fx.id)
                    if best_streak is None or streaks[team] > best_streak['wins']:
                        best_streak = {'team': team, 'wins': streaks[team],
                                       'streak_matches': winning_streak_matches[team].copy()}
                    losing_streaks[team] = 0
                    losing_streak_matches[team] = []
                else:
                    streaks[team] = 0
                    winning_streak_matches[team] = []
                    losing_streaks[team] += 1
                    losing_streak_matches[team].append(fx.id)
                    if worst_streak is None or losing_streaks[team] > worst_streak['losses']:
                        worst_streak = {'team': team, 'losses': losing_streaks[team],
                                        'streak_matches': losing_streak_matches[team].copy()}
        else:
            for team in sides:
                if team in streaks:
                    streaks[team] = 0
                    winning_streak_matches[team] = []
                    losing_streaks[team] = 0
                    losing_streak_matches[team] = []

    all_results = sorted((fx for fx in fixtures if fx.Win_T is not None),
                         key=lambda fx: start_DT(fx.Date, fx.Time))
    for streak in (best_streak, worst_streak):
        if streak is None:
            continue
        streak_matches = set(streak['streak_matches'])
        streak['form'] = [
            {
                'match': fx.Match_No,
                'result': ('W' if fx.Win_T == streak['team'] else
                           'L' if fx.Win_T in TEAMS else 'D'),
                'in_streak': fx.id in streak_matches,
                'description': ('Won' if fx.Win_T == streak['team'] else
                                'Lost' if fx.Win_T in TEAMS else
                                'No result' if 'abandoned' in (fx.Result or '').lower()
                                else 'Draw'),
            }
            for fx in all_results if streak['team'] in (fx.Team_A, fx.Team_B)
        ]

    return {
        'highest_total': max(totals, key=lambda row: row['runs']) if totals else None,
        'lowest_total': min(totals, key=lambda row: row['runs']) if totals else None,
        'narrowest_win_runs': min((m for m in margins if m['unit'] == 'runs'),
                                  key=lambda row: row['value'], default=None),
        'narrowest_win_wickets': min((m for m in margins if m['unit'] == 'wickets'),
                                     key=lambda row: row['value'], default=None),
        'biggest_win_runs': max((m for m in margins if m['unit'] == 'runs'),
                                key=lambda row: row['value'], default=None),
        'biggest_win_wickets': max((m for m in margins if m['unit'] == 'wickets'),
                                   key=lambda row: row['value'], default=None),
        'highest_successful_chase': max(successful_chases, key=lambda row: row['target'],
                                        default=None),
        'lowest_successful_defend': min(successful_defends, key=lambda row: row['runs'],
                                        default=None),
        'winning_streak': best_streak,
        'losing_streak': worst_streak,
    }


@main.route('/')
def index():
    PT = Pointstable.query.order_by(Pointstable.Points.desc(), Pointstable.W.desc(),
                                    Pointstable.NRR.desc(), Pointstable.id.asc()).all()
    TP = {t.category: t.stats for t in Toppers.query.order_by(Toppers.id.asc())}
    finalsData = Fixture.query.filter(Fixture.Match_No == 'Final').first()
    fixtures = Fixture.query.order_by(Fixture.id).all()
    now = datetime.now(tz).replace(tzinfo=None)
    ordered = sorted(fixtures, key=lambda fx: start_DT(fx.Date, fx.Time))
    live = [fx for fx in ordered if fx.Win_T is None and start_DT(fx.Date, fx.Time) <= now]
    upcoming = [fx for fx in ordered if fx.Win_T is None and start_DT(fx.Date, fx.Time) > now]
    completed = [fx for fx in ordered if fx.Win_T is not None]

    featured = (live[0] if live else upcoming[0] if upcoming
                else completed[-1] if completed else None)
    spotlight_matches = []
    spotlight_index = 0
    if featured:
        featured_index = ordered.index(featured)
        first_index = max(0, featured_index - 10)
        last_index = min(len(ordered), featured_index + 11)
        spotlight_index = featured_index - first_index
        for fx in ordered[first_index:last_index]:
            match_start = start_DT(fx.Date, fx.Time)
            state = ('live' if fx.Win_T is None and match_start <= now else
                     'upcoming' if fx.Win_T is None else 'completed')
            spotlight_matches.append({
                'fixture': fx,
                'state': state,
                'label': ('Live match' if state == 'live' else
                          'Next up' if state == 'upcoming' else
                          'Latest match' if fx.id == featured.id else 'Match result'),
                'start': tz.localize(match_start).isoformat(),
            })

    # Same extras the standings page shows, so the home cards can match it exactly
    return render_template('index.html', teams=full_name, clr=clr, pt=PT, tp=TP,
                           ranks=getRanksForPT(),
                           champion=finalsData.Win_T if finalsData else None,
                           spotlight_matches=spotlight_matches,
                           spotlight_index=spotlight_index,
                           records=_homepage_records(fixtures))

@main.route('/pointstable')
def displayPT():
    dataPT = Pointstable.query.order_by(Pointstable.Points.desc(),Pointstable.W.desc(),Pointstable.NRR.desc(),Pointstable.id.asc()).all()
    # "Top 1" rather than the IPL's "Top 2": with three into the playoffs and a
    # two-tie bracket, finishing first is the bye straight into the Final.
    dt = [['#', '', 'Team', 'P', 'W', 'L', 'NR', 'Pts', 'NRR', 'Last 5', 'Next', 'Win %', 'Qual %', 'Top 1'],
         [i for i in range(1, len(TEAMS) + 1)],\
         [], [], [], [], [], [], [], [], [], [], [], [], [], []]
    teams_ABV = []
    rankChanges = getRanksForPT()
    nextOpp = getNextOpponents([i.team_name for i in dataPT])
    finalsData = Fixture.query.filter(Fixture.Match_No == 'Final').first()
    for index, i in enumerate(dataPT):
        img = "/static/images/{}.png".format(i.team_name)
        nm = nextOpp[i.team_name]
        nm = nm if nm == '--' else 'vs ' + nm
        dt[1][index] = dt[1][index] if not finalsData else dt[1][index] if finalsData.Win_T != i.team_name else 'Champions'
        dt[2].append(img)
        teams_ABV.append(i.team_name)
        dt[3].append(full_name[i.team_name])
        dt[4].append(i.P)
        dt[5].append(i.W)
        dt[6].append(i.L)
        dt[7].append(i.NR)
        dt[8].append(i.Points)
        I = '{0:+}'.format(i.NRR)
        dt[9].append(I)
        wl = list(eval(i.Win_List).values())
        wl = wl if len(wl)<5 else wl[-5:]
        wl = list(wl)
        wl = ''.join(wl)
        dt[10].append(wl)
        dt[11].append(nm)
        dt[12].append(i.qed)
        dt[13].append(i.Qual)
        dt[14].append(i.Top1)
        dt[15].append(rankChanges[i.team_name] if i.P != 0 else 0)
    return render_template('displayPT.html', PT=dt, TABV=teams_ABV, clr=clr)

@main.route('/fixtures')
def displayFR():
    team = request.args.get('fteam','All',type=str)
    if team == 'All':
        dataFR = db.session.execute(text('select * from Fixture order by id'))\
            #Fixture.query.all()
        hint = 'All'
    else:
        dataFR = db.session.execute(text('SELECT * FROM Fixture WHERE "Team_A" = :team OR "Team_B" = :team order by id'),{'team': team}).fetchall()
            #Fixture.query.filter_by(or_(Fixture.Team_A == team, Fixture.Team_B == team)).all()
        hint = team
    dt = [['Match No', 'Date', 'Venue', 'Team-A', 'Team-B', 'TA-Score', 'TB-Score', 'WT', 'WType', 'WBy', 'Result']]
    for i in dataFR:
        dtt = []
        dtt.append(i[1]) #Match No
        # start_DT, not strftime: these rows come back from a raw text() SELECT,
        # and SQLite hands the date and time back as the ISO strings it stored
        # where Postgres hands back date and time objects.
        dtt.append(start_DT(i[2], i[3]))  #DateTime
        dtt.append(i[6])  #Venue
        dtt.append(i[4])  #Team A
        dtt.append(i[5])  #Team B
        A, B = i[8], i[9]
        dtt.append(A) #TA_Scr
        dtt.append(B) #TB_Scr
        if i[10] is None:
            dtt.append('TBA') #Win-Team
            dtt.append('TBA')
            dtt.append('TBA')
            dtt.append('TBA')
            dtt.append(['TBA','TBA'])
        elif i[10] == 'NA':
            dtt.append('NA')
            dtt.append('NA')
            dtt.append('NA')
            dtt.append(i[7])
            dtt.append(['NA','NA'])
        else:
            dtt.append(i[10])
            WType = 'wickets' if 'wickets' in i[7] else 'runs'
            dtt.append(WType)
            WBy = re.findall(r'\d+', i[7])[0]
            dtt.append(str(WBy))
            dtt.append(i[7][i[7].index('won'):])
            if i[12] is not None:
                dtt.append([i[12]['name'], i[12]['team']])
            else:
                dtt.append(['NA','NA'])
        dt.append(dtt)
    current_date = datetime.now(tz)
    current_date = current_date.replace(tzinfo=None)
    return render_template('displayFR.html', FR=dt, hint=hint, fn=full_name, current_date=current_date, clr=clr, sqclr=sqclr)

@main.route('/predictor')
def predictor():
    """The season predictor: play the rest of the WPL out and see what happens.

    The shell only; js/predictor.js fetches the fixtures and drives every
    simulation from /api/predictor/*. Nothing on this page writes a result -
    picks live in the browser and the standings it shows are hypothetical.
    """
    return render_template('predictor.html', fn=full_name, clr=clr)

@main.route('/todayMatch')
def todayMatch():
    current_date = datetime.now(tz).replace(tzinfo=None).date()
    TodayFR = db.session.execute(text('SELECT * FROM Fixture WHERE "Date" = :current_date order by id'),{'current_date': current_date}).fetchall()
    if len(TodayFR) == 0:
        return render_template('no_live_match.html')
    else:
        dt = [['Match No', 'Date', 'Venue', 'Team-A', 'Team-B', 'TA-Score', 'TB-Score', 'WT', 'WType', 'WBy', 'Result']]
        for i in TodayFR:
            dtt = []
            dtt.append(i[1])  # Match No
            dtt.append(start_DT(i[2], i[3]))  # DateTime
            dtt.append(i[6])  # Venue
            dtt.append(i[4])  # Team A
            dtt.append(i[5])  # Team B
            A, B = i[8], i[9]
            dtt.append(A)  # TA_Scr
            dtt.append(B)  # TB_Scr
            if i[10] is None:
                dtt.append('TBA')  # Win-Team
                dtt.append('TBA')
                dtt.append('TBA')
            elif i[10] == 'NA':
                dtt.append('NA')
                dtt.append('NA')
                dtt.append('NA')
                dtt.append(i[7])
                dtt.append(['NA', 'NA'])
            else:
                dtt.append(i[10])
                WType = 'wickets' if 'wickets' in i[7] else 'runs'
                dtt.append(WType)
                WBy = re.findall(r'\d+', i[7])[0]
                dtt.append(str(WBy))
                dtt.append(i[7][i[7].index('won'):])
                if i[12] is not None:
                    dtt.append([i[12]['name'], i[12]['team']])
                else:
                    dtt.append(['NA','NA'])
            dt.append(dtt)
        current_date = datetime.now(tz)
        current_date = current_date.replace(tzinfo=None)
        return render_template('liveMatches.html', FR=dt, fn=full_name, current_date=current_date, clr=clr)

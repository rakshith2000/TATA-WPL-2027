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

@main.route('/')
def index():
    PT = Pointstable.query.order_by(Pointstable.Points.desc(), Pointstable.W.desc(),
                                    Pointstable.NRR.desc(), Pointstable.id.asc()).all()
    TP = {t.category: t.stats for t in Toppers.query.order_by(Toppers.id.asc())}
    finalsData = Fixture.query.filter(Fixture.Match_No == 'Final').first()
    # Same extras the standings page shows, so the home cards can match it exactly
    return render_template('index.html', teams=full_name, clr=clr, pt=PT, tp=TP,
                           ranks=getRanksForPT(),
                           nxt=getNextOpponents([i.team_name for i in PT]),
                           champion=finalsData.Win_T if finalsData else None)

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

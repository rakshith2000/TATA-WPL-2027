"""The live match feed, shaped for the /api/match-<no>/... endpoints.

One builder per tab of the match centre. They all pull the same upstream
payload and differ in how much they resolve: get_liveStrip() is deliberately
thin because the fixtures page polls it every 10s, the rest run feed names
through find_player() so the page shows our spelling and the right crest.

The pages are sent full_name, the short form, because that is what they print.
Anything reading a team name back out of the feed has to use full_name2 instead
- sportskeeda names a side "Mumbai Indians Women" - which is why get_liveStrip()
builds its reverse lookup from both.
"""
import requests
from datetime import datetime
from sqlalchemy.sql import text

from .. import db
from ..config import teamID, full_name, full_name2, short_name, clr, ptclr, sqclr, win_prob
from ..utils.dates import tz, concat_DT
from ..utils.formatting import serialize, num_suffix
from .players import find_player, team_abbr
from .feeds import render_live_URL, get_innings_data

def get_matchInfo(match):
    MatchDT = db.session.execute(text('SELECT * FROM Fixture WHERE "Match_No" = :matchno'), {'matchno': match}).fetchall()
    MatchURL = render_live_URL(MatchDT[0][4], MatchDT[0][5], match, MatchDT[0][2])
    dttm = concat_DT(MatchDT[0][2], MatchDT[0][3])
    response = requests.get(MatchURL, verify=False)
    MatchLDT = response.json()
    MatchDT2 = []
    MatchDT2.append(num_suffix(int(MatchDT[0][1]))+" Match" if MatchDT[0][1].isdigit() else MatchDT[0][1])
    MatchDT2.append(MatchDT[0][6].split(", ")[1])
    MatchDT2.append(num_suffix(MatchDT[0][2].day)+" "+MatchDT[0][2].strftime("%B %Y"))
    current_date = datetime.now(tz)
    current_date = current_date.replace(tzinfo=None)
    MatchDT = [dict(row._mapping) for row in MatchDT]
    return serialize({'match': match, 'cd': current_date, 'dt1': MatchDT, 'dt2': MatchDT2, 'dt3': MatchLDT,
                      'tid': teamID, 'dttm': dttm, 'clr2': clr, 'fn': full_name})

def get_matchOvers(match):
    MatchDT = db.session.execute(text('SELECT * FROM Fixture WHERE "Match_No" = :matchno'), {'matchno': match}).fetchall()
    MatchURL = render_live_URL(MatchDT[0][4], MatchDT[0][5], match, MatchDT[0][2])
    dttm = concat_DT(MatchDT[0][2], MatchDT[0][3])
    response = requests.get(MatchURL, verify=False)
    MatchLDT = response.json()
    # The scorecard feed is fetched first because it is the one that knows how
    # many innings there are: a super over adds a third and a fourth, and apiv2
    # has to be asked for each of them by number.
    Inns = get_innings_data(MatchDT[0][11], len(MatchLDT.get('innings') or []))
    MatchDT2 = []
    MatchDT2.append(num_suffix(int(MatchDT[0][1]))+" Match" if MatchDT[0][1].isdigit() else MatchDT[0][1])
    MatchDT2.append(MatchDT[0][6].split(", ")[1])
    MatchDT2.append(num_suffix(MatchDT[0][2].day)+" "+MatchDT[0][2].strftime("%B %Y"))
    current_date = datetime.now(tz)
    current_date = current_date.replace(tzinfo=None)
    MatchDT = [dict(row._mapping) for row in MatchDT]
    # ptclr/sqclr ride along for the graphs tab, which draws a line per team and
    # so needs the single-colour and gradient picks as well as the full set.
    return serialize({'match':match, 'cd':current_date, 'dt1':MatchDT, 'dt2':MatchDT2, 'dt3':MatchLDT, 'tid':teamID, 'dttm':dttm, 'inns':Inns, 'clr':clr, 'ptclr':ptclr, 'sqclr':sqclr})

def get_liveScore(match):
    MatchDT = db.session.execute(text('SELECT * FROM Fixture WHERE "Match_No" = :matchno'),{'matchno': match}).fetchall()
    SquadFull = (db.session.execute(text('SELECT * FROM Squad')).fetchall())
    MatchURL = render_live_URL(MatchDT[0][4], MatchDT[0][5], match, MatchDT[0][2])
    dttm = concat_DT(MatchDT[0][2], MatchDT[0][3])
    response = requests.get(MatchURL, verify=False)
    MatchLDT = response.json()
    # Innings count first, then the commentary: see get_matchOvers() above.
    Inns = get_innings_data(MatchDT[0][11], len(MatchLDT.get('innings') or []))
    if "player_of_match" in MatchLDT and MatchLDT["player_of_match"]["player_name"] != "":
        pom = find_player(MatchLDT["player_of_match"]["player_name"], SquadFull)
        MatchLDT["player_of_match"]["player_name"] = pom[2] if pom is not None else MatchLDT["player_of_match"]["player_name"]
        MatchLDT["player_of_match"]["team_name"] = pom[3] if pom is not None else "NA"
    if "player_of_series" in MatchLDT and MatchLDT["player_of_series"]["player_name"] != "":
        pos = find_player(MatchLDT["player_of_series"]["player_name"], SquadFull)
        MatchLDT["player_of_series"]["player_name"] = pos[2] if pos is not None else MatchLDT["player_of_series"]["player_name"]
        MatchLDT["player_of_series"]["team_name"] = pos[3] if pos is not None else "NA"
    for key, batsman in MatchLDT["now_batting"].items():
        if batsman["name"] != "":
            player = find_player(batsman["name"], SquadFull)
            batsman["name"] = player[2] if player is not None else batsman["name"]
            batsman["team"] = player[3] if player is not None else "NA"
    for key, bowler in MatchLDT["now_bowling"].items():
        if bowler["name"] != "":
            player = find_player(bowler["name"], SquadFull)
            bowler["name"] = player[2] if player is not None else bowler["name"]
            bowler["team"] = player[3] if player is not None else "NA"
    # The win-probability block is keyed by the feed's own team codes ("MI-W",
    # "RCB-W"), and the panel looks its two sides up by our abbreviation. Rekey
    # it here rather than teaching the panel a second vocabulary; anything the
    # map does not know is left as it came so nothing is silently lost.
    prob = MatchLDT.get("team_win_probability")
    if isinstance(prob, dict):
        MatchLDT["team_win_probability"] = {win_prob.get(k, k): v for k, v in prob.items()}
    MatchDT2 = []
    MatchDT2.append(num_suffix(int(MatchDT[0][1])) + " Match" if MatchDT[0][1].isdigit() else MatchDT[0][1])
    MatchDT2.append(MatchDT[0][6].split(", ")[1])
    MatchDT2.append(num_suffix(MatchDT[0][2].day) + " " + MatchDT[0][2].strftime("%B %Y"))
    current_date = datetime.now(tz)
    current_date = current_date.replace(tzinfo=None)
    MatchDT = [dict(row._mapping) for row in MatchDT]
    return serialize({'match': match, 'cd': current_date, 'dt1': MatchDT, 'dt2': MatchDT2, 'dt3': MatchLDT, 'tid': teamID, 'dttm': dttm, 'clr': ptclr, 'clr2': clr, 'inns': Inns, 'fn': full_name})

def get_liveStrip(match):
    """Scores + status line only, for the ticker on the fixtures list.

    The fixtures page polls this every 10s for each in-progress match, so it is
    kept deliberately thin: no squad load, no player-name matching. It exists
    because cmc2.sportskeeda.com only sends Access-Control-Allow-Origin for
    www.sportskeeda.com, so the browser cannot read that response directly.

    Returns {'ok': bool, 'teams': [{team, score, batting}], 'info': str}.
    Upstream problems come back as ok=False rather than an error, so the page
    just keeps showing the last score it had.
    """
    blank = {'match': match, 'ok': False, 'teams': [], 'info': '', 'status': ''}
    try:
        MatchDT = db.session.execute(
            text('SELECT * FROM Fixture WHERE "Match_No" = :matchno'),
            {'matchno': match}).fetchall()
        if not MatchDT:
            return blank
        row = MatchDT[0]
        MatchURL = render_live_URL(row[4], row[5], match, row[2])
        MatchLDT = requests.get(MatchURL, verify=False, timeout=10).json()
    except Exception:
        return blank

    # The feed names teams in full with the Women suffix ("Royal Challengers
    # Bengaluru Women"); map that back to our abbreviation so the card can tell
    # which side is which. The short form is accepted too, and so are the
    # abbreviations the strip uses when it drops the long name altogether
    # ("RCB W", "GJ-W"), because it is not consistent between matches.
    abv_of = {}
    for src in (full_name2, full_name):
        for abv, name in src.items():
            abv_of.setdefault(name, abv)
    for abv, name in short_name.items():
        abv_of.setdefault(name, abv)
    abv_of.update(win_prob)
    teams = []
    for t in (MatchLDT.get('score_strip') or []):
        name = t.get('name') or t.get('p_name') or ''
        short = (t.get('short_name') or '').strip()
        teams.append({
            'team': abv_of.get(name) or abv_of.get(short)
                    or abv_of.get(short.replace(' ', '-')) or short,
            'score': (t.get('score') or '').strip(),
            'batting': bool(t.get('currently_batting')),
        })

    return {'match': match, 'ok': True, 'teams': teams,
            'info': MatchLDT.get('info') or '',
            'status': MatchLDT.get('match_status') or ''}

def get_scoreCard(match):
    MatchDT = db.session.execute(text('SELECT * FROM Fixture WHERE "Match_No" = :matchno'), {'matchno': match}).fetchall()
    SquadFull = (db.session.execute(text('SELECT * FROM Squad')).fetchall())
    MatchURL = render_live_URL(MatchDT[0][4], MatchDT[0][5], match, MatchDT[0][2])
    dttm = concat_DT(MatchDT[0][2], MatchDT[0][3])
    response = requests.get(MatchURL, verify=False)
    MatchLDT = response.json()
    if "player_of_match" in MatchLDT and MatchLDT["player_of_match"]["player_name"] != "":
        pom = find_player(MatchLDT["player_of_match"]["player_name"], SquadFull)
        MatchLDT["player_of_match"]["player_name"] = pom[2] if pom is not None else MatchLDT["player_of_match"]["player_name"]
        MatchLDT["player_of_match"]["team_name"] = pom[3] if pom is not None else "NA"
    if "player_of_series" in MatchLDT and MatchLDT["player_of_series"]["player_name"] != "":
        pos = find_player(MatchLDT["player_of_series"]["player_name"], SquadFull)
        MatchLDT["player_of_series"]["player_name"] = pos[2] if pos is not None else MatchLDT["player_of_series"]["player_name"]
        MatchLDT["player_of_series"]["team_name"] = pos[3] if pos is not None else "NA"
    # Which side a name belongs to is already in the innings, so tell find_player:
    # it settles the namesakes a bare "M Choudhary" cannot.
    # Every innings, not just the first two: a super over is a third and a fourth
    # (and a fifth and sixth when that one is tied too), and those carry batting,
    # bowling and a fall of wickets of their own that need the same resolving.
    sides = (MatchDT[0][4], MatchDT[0][5])
    for inn in MatchLDT.get("innings", []):
        bat_team = team_abbr(inn.get("batting_team_id"))
        bowl_team = next((t for t in sides if t != bat_team), None) if bat_team in sides else None
        if "batting" in inn:
            for batsman in inn["batting"]:
                player = find_player(batsman["name"], SquadFull, team=bat_team)
                batsman["name"] = player[2] if player is not None else batsman["name"]
                batsman["team"] = player[3] if player is not None else "NA"
        if "bowling" in inn:
            for bowler in inn["bowling"]:
                player = find_player(bowler["name"], SquadFull, team=bowl_team)
                bowler["name"] = player[2] if player is not None else bowler["name"]
                bowler["team"] = player[3] if player is not None else "NA"
        if "not_batted" in inn:
            nb = sorted(inn['not_batted'].values(), key=lambda x: x['order'])
            for nbb in nb:
                nbd = find_player(nbb["name"], SquadFull, team=bat_team)
                nbb["name"] = nbd[2] if nbd is not None else nbb["name"]
                nbb["team"] = nbd[3] if nbd is not None else "NA"
            inn['not_batted'] = nb
        if inn.get("fall_of_wickets") is not None:
            fow = []
            if inn["fall_of_wickets"] != "":
                for bt in inn["fall_of_wickets"].split('),'):
                    btd = find_player(bt.split(' (')[1].split(',')[0], SquadFull, team=bat_team)
                    n = btd[2] if btd is not None else bt.split(' (')[1].split(',')[0]
                    t = btd[3] if btd is not None else "NA"
                    score = bt.split(' (')[0]
                    over = bt.split(' (')[1].split(', ')[1].strip('()')
                    fow.append({"name": n, "team": t, "score": score, "over": over})
            inn["fall_of_wickets"] = fow
    MatchDT2 = []
    MatchDT2.append(num_suffix(int(MatchDT[0][1])) + " Match" if MatchDT[0][1].isdigit() else MatchDT[0][1])
    MatchDT2.append(MatchDT[0][6].split(", ")[1])
    MatchDT2.append(num_suffix(MatchDT[0][2].day) + " " + MatchDT[0][2].strftime("%B %Y"))
    current_date = datetime.now(tz)
    current_date = current_date.replace(tzinfo=None)
    MatchDT = [dict(row._mapping) for row in MatchDT]
    return serialize({'match': match, 'cd': current_date, 'dt1': MatchDT, 'dt2': MatchDT2, 'dt3': MatchLDT, 'tid': teamID, 'dttm': dttm, 'clr2': clr, 'fn': full_name})

def get_liveSquad(match):
    MatchDT = db.session.execute(text('SELECT * FROM Fixture WHERE "Match_No" = :matchno'), {'matchno': match}).fetchall()
    SquadFull = (db.session.execute(text('SELECT * FROM Squad')).fetchall())
    SquadDT = db.session.execute(text('SELECT * FROM Squad WHERE "Captain" = :captain OR "Overseas" = :overseas'), {'captain': 'Y', 'overseas': 'Y'}).fetchall()
    MatchURL = render_live_URL(MatchDT[0][4], MatchDT[0][5], match, MatchDT[0][2])
    dttm = concat_DT(MatchDT[0][2], MatchDT[0][3])
    response = requests.get(MatchURL, verify=False)
    MatchLDT = response.json()
    for sqd in MatchLDT.get("squad", []):
        sq_team = team_abbr(sqd.get('team_id'))
        if sqd['players'] is not None:
            for player in sqd['players']:
                p = find_player(player['name'], SquadFull, team=sq_team)
                player['name'] = p[2] if p is not None else player['name']
                player['team'] = p[3] if p is not None else "NA"
                player['captain'] = (True if p[4] == 'Y' else False) if p is not None else False
                player['overseas'] = (True if p[6] == 'Y' else False) if p is not None else False
        if sqd['substitute_players'] is not None:
            for sub in sqd['substitute_players']:
                p = find_player(sub['name'], SquadFull, team=sq_team)
                sub['name'] = p[2] if p is not None else sub['name']
                sub['team'] = p[3] if p is not None else "NA"
                sub['captain'] = (True if p[4] == 'Y' else False) if p is not None else False
                sub['overseas'] = (True if p[6] == 'Y' else False) if p is not None else False
        if sqd['bench_players'] is not None:
            for bench in sqd['bench_players']:
                p = find_player(bench['name'], SquadFull, team=sq_team)
                bench['name'] = p[2] if p is not None else bench['name']
                bench['team'] = p[3] if p is not None else "NA"
                bench['captain'] = (True if p[4] == 'Y' else False) if p is not None else False
                bench['overseas'] = (True if p[6] == 'Y' else False) if p is not None else False
    MatchDT2 = []
    MatchDT2.append(num_suffix(int(MatchDT[0][1])) + " Match" if MatchDT[0][1].isdigit() else MatchDT[0][1])
    MatchDT2.append(MatchDT[0][6].split(", ")[1])
    MatchDT2.append(num_suffix(MatchDT[0][2].day) + " " + MatchDT[0][2].strftime("%B %Y"))
    current_date = datetime.now(tz)
    current_date = current_date.replace(tzinfo=None)
    MatchDT = [dict(row._mapping) for row in MatchDT]
    SquadDT = [dict(row._mapping) for row in SquadDT]
    return serialize({'match': match, 'cd':current_date, 'dt1':MatchDT, 'dt2':MatchDT2, 'dt3':MatchLDT, 'tid':teamID,
                      'dttm':dttm, 'sqd':SquadDT, 'clr2': clr, 'fn': full_name})

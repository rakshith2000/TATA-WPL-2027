"""The stats leaderboards: refreshing them from the feed, and reading them back.

Same table, same feed and same categories as the IPL app. A leaderboard is one
Toppers row holding a list of the feed's own rows, keyed the way the feed keys
them - StrikerName, BowlerName, TeamCode, TotalRuns - so the home-page toppers
carousel, the two leaderboard pages and the awards page read one vocabulary
across both leagues.

The feed answers JSONP rather than JSON: a callback wrapper around a single
object whose one value is the row list. Unwrapping that is the first thing
below. Player names come back in the feed's own spelling, so each row's name is
resolved against the Squad table, which also supplies the crest the row wears.

One category is ours rather than the feed's: Most POTM, counted from the player
of the match stored on each result. seed_toppers() seeds it alongside the rest.

`json` here is flask.json, as it was when this lived in main.py - keep it that
way, the error handling below depends on which module the name comes from.
"""
import requests
from flask import json
from sqlalchemy.sql import text
from sqlalchemy.orm.attributes import flag_modified
from collections import Counter

from .. import db
from ..models import Squad, Toppers
from ..config import statsList, statsURL, COMPETITION_ID, SEASON_YEAR
from ..utils.formatting import serialize
from .players import find_player
from .player_stats import get_player_stats


def update_potm():
    """Most player-of-the-match awards, counted off the fixtures.

    Nothing publishes this, so it is built from the POTM stored on each result
    and then enriched from the player's own season record - which is what the
    ties are broken on when two players are level on awards.
    """
    potms = (db.session.execute(text('SELECT "POTM" FROM Fixture WHERE "POTM" IS NOT NULL')).fetchall())
    counts = Counter([(p[0]['name'], p[0]['team']) for p in potms])
    potms = [{"name": name, "team": team, "potm": count} for (name, team), count in counts.items()]

    for potm in potms:
        sq = Squad.query.filter_by(Name=potm['name']).first()
        stats = get_player_stats(sq.Player_URL) if sq else None
        season = (stats or {}).get(SEASON_YEAR)
        if season:
            bat, bowl = season.get('batting') or {}, season.get('bowling') or {}
            potm['matches'] = int(bat['Matches']) if bat.get('Matches') else 0
            potm['innings'] = int(bat['Innings']) if bat.get('Innings') else 0
            potm['runs'] = int(bat['Runs']) if bat.get('Runs') else 0
            potm['wickets'] = int(bowl['Wickets']) if bowl.get('Wickets') else 0

    try:
        potms = sorted(potms, key=lambda x: (x['potm'], x['runs'], x['wickets']), reverse=True)
    except Exception as e:
        print(f"Error while sorting the toppers for Most POTM: {e}")
        batStat = Toppers.query.filter_by(category="Most Runs").first()
        bowlStat = Toppers.query.filter_by(category="Most Wickets").first()
        if batStat and batStat.stats:
            batMat = {item['StrikerName']: item['Matches'] for item in batStat.stats}
            batInns = {item['StrikerName']: item['Innings'] for item in batStat.stats}
            batRuns = {item['StrikerName']: item['TotalRuns'] for item in batStat.stats}
        else:
            batMat, batInns, batRuns = {}, {}, {}
        if bowlStat and bowlStat.stats:
            bowlWkts = {item['BowlerName']: item['Wickets'] for item in bowlStat.stats}
        else:
            bowlWkts = {}
        for potm in potms:
            potm['matches'] = batMat.get(potm['name'], 0)
            potm['innings'] = batInns.get(potm['name'], 0)
            potm['runs'] = batRuns.get(potm['name'], 0)
            potm['wickets'] = bowlWkts.get(potm['name'], 0)
        potms = sorted(potms, key=lambda x: (x['potm'], x['runs'], x['wickets']), reverse=True)
    finally:
        toppers = Toppers.query.filter_by(category="Most POTM").first()
        if toppers:
            toppers.stats = potms
            db.session.commit()


def update_toppers():
    """Refresh every leaderboard from the feed, into the Toppers table.

    A leaderboard the feed cannot answer for keeps whatever it already had,
    with the player names re-resolved against the squad in case the squad has
    moved on. That matters more than usual right now: the feed host is down,
    so this is the path every category takes.
    """
    SquadFull = (db.session.execute(text('SELECT * FROM Squad')).fetchall())
    # update_potm()
    for stats_type, stats in statsList.items():
        for stat_name, token in stats.items():
            try:
                # The two awards are filed under the season year; everything
                # else under the season's competition id.
                prefix = SEASON_YEAR if stats_type == "awards" else COMPETITION_ID
                url = statsURL + f"{prefix}-{token}.js"
                response = requests.get(url, verify=False)
                data = response.text
                data = data.split('(', 1)[1].strip(');')
                data = next(iter((json.loads(data)).values()))
                tp = Toppers.query.filter_by(category=stat_name).first()
                if data and isinstance(data, list) and len(data) > 0:
                    if stat_name not in ["Fair Play Award"]:
                        for row in data:
                            playerKey = 'StrikerName' if stats_type == "batting_stats" else 'BowlerName' if stats_type == "bowling_stats" else 'PlayerName'
                            player = find_player(row[playerKey], SquadFull, team=row.get('TeamCode'))
                            row[playerKey] = player[2] if player is not None else row[playerKey]
                            row['TeamCode'] = player[3] if player is not None else row['TeamCode']
                    tp.stats = data
                else:
                    tp.stats = None
                db.session.commit()
            except Exception as e:
                print(f"Error updating toppers for {stat_name}: {e}")
                print(f"Mapping Player Name for exisiting for {stat_name} if any (Failure case)")
                tp = Toppers.query.filter_by(category=stat_name).first()
                if tp and tp.stats and stat_name != "Fair Play Award":
                    playerKey = ("StrikerName" if stats_type == "batting_stats" else "BowlerName" if stats_type == "bowling_stats" else "PlayerName")
                    for row in tp.stats:
                        player_name = row.get(playerKey)
                        if not player_name:
                            continue
                        player = find_player(player_name, SquadFull, team=row.get("TeamCode"))

                        if player:
                            row[playerKey] = player[2]
                            row["TeamCode"] = player[3]

                    flag_modified(tp, "stats")
                    db.session.commit()
    update_potm()


def get_stats():
    """Every leaderboard, keyed by category, for /api/stats.

    The rows come back from a raw text() SELECT, so SQLAlchemy does not know
    the stats column is JSON: Postgres hands a list back either way, SQLite
    hands back the text it stored. Decoding here means the page always
    receives a list of rows rather than, on SQLite, one long string.
    """
    tp = db.session.execute(text('SELECT category, stats FROM Toppers ORDER BY id ASC')).fetchall()
    out = {}
    for category, stats in tp:
        if isinstance(stats, str):
            try:
                stats = json.loads(stats)
            except ValueError:
                stats = None
        out[category] = stats
    return serialize({'stats': out})

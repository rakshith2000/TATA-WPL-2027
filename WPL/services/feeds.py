"""Upstream feeds: building the live-score URL and fetching from it."""
import requests
from sqlalchemy.sql import text

from .. import db
from ..config import (full_name2, liveURL_Prefix, liveURL_Suffix, liveURL_Slug,
                      liveURL_Swaps)
from .players import find_player

def render_live_URL(tA, tB, mn, dt):
    """The sportskeeda ajax URL for one fixture.

    Built from full_name2, not full_name: sportskeeda spells a WPL side out with
    the "Women" suffix, so the slug is "mumbai-indians-women-vs-...". Getting
    that wrong is a 404, not a wrong name on the page.

    Sportskeeda also files some matches under the opposite team order from our
    fixture sheet - it lists whoever it calls the home side first, and for a
    season at neutral grounds that is not always our Team_A. The numbers it
    disagrees on are in config.json under urls.live.swap_sides.
    """
    if mn.isdigit() and int(mn) in liveURL_Swaps:
        tA, tB = tB, tA
    teamAB = full_name2[tA].replace(" ", "-").lower() + "-vs-" + full_name2[tB].replace(" ", "-").lower()
    if mn.isdigit():
        matchNo = "match-" + mn
    elif tA != "TBA" and tB != "TBA":
        matchNo = mn.lower().replace(' ', '-')
    else:
        # The sides are not known yet, so sportskeeda files the tie under the
        # season rather than under two teams.
        matchNo = mn.lower().replace(' ', '-') + "-" + liveURL_Slug
    dt = dt.strftime("%d-%B-%Y").lower()
    URL = liveURL_Prefix + teamAB + "-" + matchNo + "-" + dt + liveURL_Suffix
    print(URL)
    return URL

def get_innings_data(matID, count=2):
    """Ball-by-ball commentary from apiv2, one call per innings.

    apiv2 answers for a single innings at a time, so how many calls to make has
    to come from the scorecard feed: a super over is a further innings on both
    sides, numbered straight on from the match proper, so innings 3 and 4 are the
    first super over, 5 and 6 a second one when the first is also tied.

    Two is the floor - before the first ball the scorecard carries no innings at
    all, and the first two are what the page asks for either way. An innings
    apiv2 has nothing for answers {"responseError": false} with no "inning" key;
    that is stored as None so a panel can tell "not played" from "played, no
    commentary" without having to know the feed's shape.

    Returns a list, one entry per innings, in innings order.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.cricket.com.au/",
        "Origin": "https://www.cricket.com.au",
        "Accept": "application/json",
        }

    try:
        count = max(int(count or 0), 2)
    except (TypeError, ValueError):
        count = 2

    innings = []
    for inn in range(1, count + 1):
        try:
            response = requests.get(f"https://apiv2.cricket.com.au/web/views/comments?fixtureId={matID}&inningNumber={inn}&commentType=&overLimit=21&jsconfig=eccn%3Atrue&format=json", headers=headers, verify=False, timeout=15)
            payload = response.json()
            innings.append(payload if isinstance(payload, dict) and payload.get('inning') else None)
        except Exception as e:
            print(f"Error fetching innings {inn} for fixture {matID}: {e}")
            innings.append(None)
    return innings

def get_data_from_url(url):
    response = requests.get(url, verify=False)
    res = response.json()
    SquadDT = (db.session.execute(text('SELECT * FROM Squad')).fetchall())
    if response.status_code == 200:
        try:
            headers = res['t20StatsList']['headers']
            data = []
            for row in res['t20StatsList']['values']:
                d = {}
                for value, head in zip(row['values'][1:], headers):
                    if 'Team' not in d:
                        match = find_player(value, SquadDT)
                        d['Team'] = match[3] if match else "NA"
                        d[head.capitalize()] = match[2] if match else value
                    else:
                        d[head.capitalize()] = value
                data.append(d)
            return data
        except Exception:
            return None
    else:
        return None

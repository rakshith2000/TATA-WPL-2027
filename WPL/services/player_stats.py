"""One player's career record, from the WPL player profile.

The shape of the source is the whole problem here. The IPL publishes a stats
feed of named fields - {"Batting": [{"Year": "2026", "Runs": "412", ...}, ...]}
- and the player page and its script are written against those names. The WPL
has no such feed: wplt20.com embeds window.playerStatsWidgetData in the profile
page, and a season in there is a bare positional array, with the two
disciplines split into "Batting & Fielding" and "Bowling" rather than being
keyed by year, and the career line held somewhere else again.

So the fetch is different and everything downstream is not. This module reads
the widget, names the positions from config.json's player_stats.headers, and
folds the result into exactly the dict get_player_stats() returns for the IPL:

    {'Overall': {'batting': {...} | None, 'bowling': {...} | None},
     'years':   ['2026', '2025', ...]            # newest first, or None
     '2026':    {'batting': {...}, 'bowling': {...} | None},
     ...}

squad_details.html, js/squad-details.js and services/toppers.update_potm() all
read it through those keys and never need to know which league they are in.

Two WPL-specific columns survive the fold because they are real and the IPL
does not have them: maidens, and three-wicket hauls where the IPL counts fours.
js/squad-details.js lists them in its bowling columns.

`json` here is flask.json, as it was when this lived in main.py - keep it that
way, the error handling below depends on which module the name comes from.
"""
import re
import requests
from flask import json

from ..config import ps_headers, ps_index

_WIDGET_RE = re.compile(r'window\.playerStatsWidgetData\s*=\s*(\{.*?\});', re.DOTALL)

# Position names (from config) -> the keys the page and the script read. The
# widget's own order is what config.json's player_stats.headers records; this
# says what each of those is called once it is in IPL shape.
_BAT_OUT = {
    'Matches': 'Matches', 'Innings': 'Innings', 'NotOuts': 'NotOuts', 'Runs': 'Runs',
    'HighestScore': 'HighestScore', 'BattingAvg': 'BattingAvg', 'StrikeRate': 'StrikeRate',
    'Hundreds': 'Hundreds', 'Fifties': 'Fifties', 'Fours': 'Fours', 'Sixes': 'Sixes',
    'Catches': 'Catches', 'Stumpings': 'Stumpings', 'TeamName': 'TeamName',
}
_BOWL_OUT = {
    'Matches': 'Matches', 'Innings': 'Innings', 'Overs': 'Overs', 'Maidens': 'Maidens',
    'Runs': 'Runs', 'Wickets': 'Wickets', 'BBM': 'BBM', 'Average': 'Average',
    'Econ': 'Econ', 'StrikeRate': 'StrikeRate', 'ThreeWkts': 'ThreeWkts',
    'FiveWkts': 'FiveWkts', 'TeamName': 'TeamName',
}

# Everything the career row of a discipline nobody has taken part in needs, so
# the page can tell "never bowled" from "bowled, figures missing".
_BOWL_BLANK = {'Matches': '0', 'Innings': '0', 'Overs': '0.0', 'Maidens': '0', 'Runs': '0',
               'Wickets': '0', 'BBM': '-', 'Average': '-', 'Econ': '-', 'StrikeRate': '-',
               'ThreeWkts': '0', 'FiveWkts': '0', 'TeamName': ''}


def _nested(data, path):
    """Walk a key/index path into the payload, or None if any step is missing."""
    value = data
    try:
        for key in path:
            value = value[key]
    except (KeyError, IndexError, TypeError):
        return None
    return value


def _row(values, header, wanted):
    """One positional season array, named and trimmed to the keys we publish.

    The widget sends a few trailing positions that are bookkeeping rather than
    figures - the sort index, the team id, a row id - so `wanted` is what gets
    through and the rest is dropped. A short array is padded rather than
    truncating the names, because the widget does drop trailing columns when a
    player has none of them.
    """
    if not isinstance(values, (list, tuple)) or not values:
        return None
    named = dict(zip(header, list(values) + [''] * (len(header) - len(values))))
    return {out: str(named.get(src, '')).strip() for src, out in wanted.items()}


def _fetch(URL):
    try:
        res = requests.get(URL, verify=False, timeout=20)
        match = _WIDGET_RE.search(res.text)
        if not match:
            return None
        blob = match.group(1)
        try:
            return json.loads(blob)
        except Exception:
            # The widget is JavaScript, not JSON, and occasionally quotes with
            # apostrophes; that is the only difference worth repairing.
            return json.loads(blob.replace("'", '"'))
    except Exception as e:
        print(f"Error fetching player stats from {URL}: {e}")
        return None


def get_player_stats(URL):
    """A player's WPL record, in the shape the IPL feed returns.

    `URL` is Squad.Player_URL - the wplt20.com profile page. Returns None when
    the page cannot be read at all, so the caller can tell that apart from a
    player who simply has no record.
    """
    if not URL:
        return None
    data = _fetch(URL)
    if data is None:
        return None

    league = ps_index['league']
    bat_header, bowl_header = ps_headers['batting'], ps_headers['bowling']

    stats = {'Overall': {'batting': None, 'bowling': None}, 'years': None}

    # ---- career line ----------------------------------------------------
    career_bat = _nested(data, ps_index['overall'] + ps_index['batting_fielding'] + [league])
    career_bowl = _nested(data, ps_index['overall'] + ps_index['bowling'] + [league])
    stats['Overall']['batting'] = _row(career_bat, bat_header, _BAT_OUT)
    stats['Overall']['bowling'] = _row(career_bowl, bowl_header, _BOWL_OUT)

    # The widget leaves the bowling half out entirely for someone who has never
    # bowled. The page needs a row there to decide whether to draw the pane at
    # all, and a zeroed one is what the IPL feed sends in the same situation.
    if stats['Overall']['batting'] and not stats['Overall']['bowling']:
        stats['Overall']['bowling'] = dict(
            _BOWL_BLANK, Matches=stats['Overall']['batting'].get('Matches', '0'),
            TeamName=stats['Overall']['batting'].get('TeamName', ''))

    # ---- season by season -----------------------------------------------
    bat_years = _nested(data, ps_index['yearly'] + ps_index['batting_fielding']) or {}
    bowl_years = _nested(data, ps_index['yearly'] + ps_index['bowling']) or {}
    # 'Desc' is the widget's own column description, not a season
    years = sorted((y for y in bat_years if y != 'Desc'), reverse=True)
    if not years:
        return stats

    stats['years'] = years
    for year in years:
        stats[year] = {
            'batting': _row(bat_years.get(year), bat_header, _BAT_OUT),
            'bowling': _row(bowl_years.get(year), bowl_header, _BOWL_OUT),
        }
    return stats

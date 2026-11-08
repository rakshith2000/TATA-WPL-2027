"""Reference data for the season, read from config.json.

The feed URLs, the playoff labels and the per-team name/colour/handle maps all
used to sit as literals at the top of main.py. None of them is code: they change
between seasons - and sometimes mid-season, when a franchise rebrands or a feed
moves - so they live in config.json and the modules that need them import the
names from here.

Keys are exposed under the same names the modules already used, so anything
reading them stays unchanged. The file is read once, at import time; editing
config.json needs a restart to take effect.

Two team-name maps, because the feeds disagree. Sportskeeda spells a WPL side
out in full with the "Women" suffix ("Mumbai Indians Women"); apiv2, the stats
feed and our own pages use the short form ("Mumbai Indians"). `full_name` is the
short one and is what the templates show; `full_name2` is the long one and is
what anything building a live-score URL or reading a team name back out of the
live feed has to use.
"""

import json
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name('config.json')

with CONFIG_PATH.open(encoding='utf-8') as fh:
    CONFIG = json.load(fh)

_urls = CONFIG['urls']
_teams = CONFIG['teams']
_colors = CONFIG['colors']

# Playoff shorthand -> the Match_No the fixture is stored under
pofs = CONFIG['playoffs']

# Season shape. Five teams, one round robin, three into the playoffs - all of
# it read rather than assumed, so a format change is a config edit.
season = CONFIG['season']
SEASON_YEAR = season['year']
LEAGUE_MATCHES = season['league_matches']
PLAYOFF_SPOTS = season['playoff_spots']
HOME_ADVANTAGE = season['home_advantage']

liveURL_Prefix = _urls['live']['prefix']
liveURL_Suffix = _urls['live']['suffix']
liveURL_Slug = _urls['live']['slug']
# League matches sportskeeda files under the reverse team order from ours
liveURL_Swaps = set(_urls['live'].get('swap_sides') or [])

statsURL = _urls['stats']
playerStatsURL = _urls['player_stats']
tp_urls = _urls['toppers']

# The number the stats feed files a season's leaderboards under. The IPL app
# has its own baked into services/toppers.py; here it is config, because it
# changes every season and it is the only thing a repoint needs.
COMPETITION_ID = _urls['competition_id']

statsList = CONFIG['stats_list']

playerStats = CONFIG['player_stats']
ps_headers = playerStats['headers']
ps_index = playerStats['index']

full_name = _teams['full_name']
full_name2 = _teams['full_name2']
short_name = _teams['short_name']
champions = _teams['champions']
teams_data = _teams['info']
teams_social = _teams['social']
teams_word = _teams['word']
teams_accent = _teams['accent']
win_prob = _teams['win_prob']

# JSON object keys are always strings; the feeds hand team ids back as numbers
# and team_abbr() looks them up as ints, so cast on the way in.
teamID = {int(k): v for k, v in _teams['ids'].items()}

clr = _colors['match']
ptclr = _colors['points_table']
ptclr_set = _colors['points_table_set']
sqclr = _colors['squad']

# Every side that plays, in config order; TBA is a placeholder, not a team.
TEAMS = [t for t in full_name if t != 'TBA']

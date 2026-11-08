"""Canned player-stats fixtures, used while the live feed is unavailable."""
import random

# ------------------------------------------------------------------ stats stand-in
# The player-stats widget is unavailable, so squad_details has nothing to draw and
# the page cannot be worked on. These fixtures stand in for it in exactly the
# shape get_player_stats() returns: all nine pairings of the three roles with the
# three career shapes the page has to cope with.
#
#   .../squad_details/Smriti%20Mandhana?stats=bowler-gaps   pick one explicitly
#   STUB_PLAYER_STATS = True                                pick by the player's role
#
# With the flag off and no ?stats= in the URL nothing changes, so this can sit
# here until the feed is back. Values are strings and years run newest-first,
# because that is what the widget does and what the template reads
# (stats['years'][-1] is the debut season).

STUB_PLAYER_STATS = True

# The WPL has only run since 2023, so a career here is four seasons at most -
# which is itself a case the page has to render well, with far fewer columns in
# a season chart than the IPL's nineteen.
_STUB_SEASONS = ('2027', '2026', '2025', '2024', '2023')

_STUB_SHAPES = {
    'all':  _STUB_SEASONS,              # ever-present
    'gaps': ('2026', '2024'),           # in and out of the side
    'none': (),                         # uncapped, never played
}

# runs per innings, strike rate, wickets per innings, economy. wpi None means
# the player does not bowl at all, which is a shape the page has to render too.
_STUB_PROFILE = {
    'batter':     {'rpi': (26, 44), 'sr': (122, 150), 'wpi': None,       'econ': None},
    'bowler':     {'rpi': (3, 10),  'sr': (84, 116),  'wpi': (1.0, 1.8), 'econ': (6.8, 8.6)},
    'allrounder': {'rpi': (16, 30), 'sr': (116, 142), 'wpi': (0.5, 1.1), 'econ': (7.2, 9.0)},
}

_STUB_ROLE_OF = {'Batter': 'batter', 'Wicket Keeper': 'batter',
                 'Bowler': 'bowler', 'All Rounder': 'allrounder'}

# TeamName comes through as the full name; squad-details.js maps it back to the
# abbreviation, so a fixture that changes team exercises that lookup.
_STUB_TEAMS = ('Mumbai Indians', 'Royal Challengers Bengaluru', 'Delhi Capitals',
               'Gujarat Giants', 'UP Warriorz')

_STUB_BAT_SUM = ('Matches', 'Innings', 'NotOuts', 'Runs', 'Balls', 'Hundreds',
                 'Fifties', 'Fours', 'Sixes', 'Catches', 'Stumpings')
_STUB_BOWL_SUM = ('Matches', 'Innings', 'Balls', 'Maidens', 'Runs', 'Wickets',
                  'ThreeWkts', 'FiveWkts')


def _stub_overs(balls):
    """Balls to the cricket over count: 47 balls is 7.5 overs, not 7.83."""
    return f'{balls // 6}.{balls % 6}'


def _stub_bat_season(rng, role, year, team):
    """One season of batting, held as numbers so Overall can be summed from it."""
    matches = rng.randint(6, 10)          # a WPL league campaign is eight matches
    innings = max(1, matches - rng.randint(0, 2))
    not_outs = min(innings - 1, rng.randint(0, 3 if role == 'bowler' else 2))
    runs = int(innings * rng.uniform(*_STUB_PROFILE[role]['rpi']))
    balls = max(1, int(runs * 100.0 / rng.uniform(*_STUB_PROFILE[role]['sr'])))
    hundreds = 1 if role == 'batter' and runs >= 330 and rng.random() < 0.3 else 0
    best = 100 + rng.randint(1, 22) if hundreds else max(1, int(runs * rng.uniform(0.24, 0.42)))
    return {'Year': year, 'TeamName': team, 'Matches': matches, 'Innings': innings,
            'NotOuts': not_outs, 'Runs': runs, 'Balls': balls,
            'Best': min(best, runs) or 1, 'BestNO': bool(not_outs and rng.random() < 0.4),
            'Hundreds': hundreds, 'Fifties': max(0, runs // 110 - hundreds),
            'Fours': int(runs * rng.uniform(0.085, 0.125)),
            'Sixes': int(runs * rng.uniform(0.025, 0.06)),
            'Catches': rng.randint(1, 6),
            'Stumpings': rng.randint(0, 3) if role == 'batter' else 0}


def _stub_bowl_season(rng, role, year, team, matches):
    """The bowling half of the same season, or None for someone who never bowls."""
    prof = _STUB_PROFILE[role]
    if prof['wpi'] is None:
        return None
    innings = max(1, matches - rng.randint(0, 2))
    balls = innings * rng.randint(18, 24)
    runs = int(balls / 6.0 * rng.uniform(*prof['econ']))
    wickets = max(0, int(innings * rng.uniform(*prof['wpi'])))
    best_w = min(wickets, rng.randint(2, 5))
    return {'Year': year, 'TeamName': team, 'Matches': matches, 'Innings': innings,
            'Balls': balls, 'Maidens': rng.randint(0, 2) if role == 'bowler' else 0,
            'Runs': runs, 'Wickets': wickets,
            'BestW': best_w, 'BestR': rng.randint(7, 34),
            'ThreeWkts': 1 if best_w >= 3 else 0, 'FiveWkts': 1 if best_w >= 5 else 0}


def _stub_bat_feed(s):
    """Season numbers -> the string-valued row get_player_stats() returns."""
    outs = max(1, s['Innings'] - s['NotOuts'])
    return {'Year': s['Year'], 'Matches': str(s['Matches']), 'Innings': str(s['Innings']),
            'NotOuts': str(s['NotOuts']), 'Runs': str(s['Runs']),
            'HighestScore': f"{s['Best']}{'*' if s['BestNO'] else ''}",
            'BattingAvg': f"{s['Runs'] / outs:.2f}",
            'StrikeRate': f"{s['Runs'] * 100.0 / s['Balls']:.2f}",
            'Hundreds': str(s['Hundreds']), 'Fifties': str(s['Fifties']),
            'Fours': str(s['Fours']), 'Sixes': str(s['Sixes']),
            'Catches': str(s['Catches']), 'Stumpings': str(s['Stumpings']),
            'TeamName': s['TeamName']}


def _stub_bowl_feed(s):
    wkts = max(1, s['Wickets'])
    return {'Year': s['Year'], 'Matches': str(s['Matches']), 'Innings': str(s['Innings']),
            'Overs': _stub_overs(s['Balls']), 'Maidens': str(s['Maidens']),
            'Runs': str(s['Runs']),
            'Wickets': str(s['Wickets']), 'BBM': f"{s['BestW']}/{s['BestR']}",
            'Average': f"{s['Runs'] / wkts:.2f}" if s['Wickets'] else '-',
            'Econ': f"{s['Runs'] * 6.0 / s['Balls']:.2f}",
            'StrikeRate': f"{s['Balls'] / wkts:.2f}" if s['Wickets'] else '-',
            'ThreeWkts': str(s['ThreeWkts']), 'FiveWkts': str(s['FiveWkts']),
            'TeamName': s['TeamName']}


def _stub_never_bowled(matches, team):
    """What the career row looks like for a batter who has never bowled."""
    return {'Year': 'Overall', 'Matches': str(matches), 'Innings': '0', 'Overs': '0.0',
            'Maidens': '0', 'Runs': '0', 'Wickets': '0', 'BBM': '-', 'Average': '-',
            'Econ': '-', 'StrikeRate': '-', 'ThreeWkts': '0', 'FiveWkts': '0',
            'TeamName': team}


def _build_stub(role, shape, seed):
    years = _STUB_SHAPES[shape]
    if not years:
        # Exactly what get_player_stats() returns when the widget has no
        # batting block: the page has to fall back to "no record yet" off this.
        return {'Overall': {'batting': None, 'bowling': None}, 'years': None}

    rng = random.Random(seed)
    current, former = rng.sample(_STUB_TEAMS, 2)
    bat, bowl = [], []
    for i, year in enumerate(years):
        team = current if i < 2 else former      # traded two seasons ago
        season = _stub_bat_season(rng, role, year, team)
        bat.append(season)
        spell = _stub_bowl_season(rng, role, year, team, season['Matches'])
        # On a patchy career, leave one season batted-but-not-bowled: that is
        # the only way to reach the per-year "bowling is None" branch.
        if spell and not (shape == 'gaps' and i == 1):
            bowl.append(spell)

    bat_all = {k: sum(s[k] for s in bat) for k in _STUB_BAT_SUM}
    peak = max(bat, key=lambda s: s['Best'])
    bat_all.update({'Year': 'Overall', 'TeamName': current,
                    'Best': peak['Best'], 'BestNO': peak['BestNO']})

    if bowl:
        bowl_all = {k: sum(s[k] for s in bowl) for k in _STUB_BOWL_SUM}
        haul = max(bowl, key=lambda s: (s['BestW'], -s['BestR']))
        bowl_all.update({'Year': 'Overall', 'TeamName': current,
                         'Matches': bat_all['Matches'],
                         'BestW': haul['BestW'], 'BestR': haul['BestR']})
        career_bowling = _stub_bowl_feed(bowl_all)
    else:
        career_bowling = _stub_never_bowled(bat_all['Matches'], current)

    stats = {'Overall': {'batting': _stub_bat_feed(bat_all), 'bowling': career_bowling},
             'years': [s['Year'] for s in bat]}
    for season in bat:
        spell = next((s for s in bowl if s['Year'] == season['Year']), None)
        stats[season['Year']] = {'batting': _stub_bat_feed(season),
                                 'bowling': _stub_bowl_feed(spell) if spell else None}
    return stats


# Seeded, so a given fixture is the same on every restart and a layout change
# can be compared against the last screenshot.
DUMMY_PLAYER_STATS = {
    f'{role}-{shape}': _build_stub(role, shape, 4200 + i)
    for i, (role, shape) in enumerate((r, s) for r in _STUB_PROFILE for s in _STUB_SHAPES)
}


def stub_player_stats(key=None, role=None, seed=0):
    """Stand-in for get_player_stats() while the widget is unreachable.

    `key` is a ?stats= value such as "bowler-gaps". With no key, and only when
    STUB_PLAYER_STATS is on, a fixture is picked from the player's own role so
    that browsing the squad shows all three career shapes. Returns None when
    neither applies, which tells the caller to go to the live profile.
    """
    if key:
        return DUMMY_PLAYER_STATS.get(key)
    if not STUB_PLAYER_STATS:
        return None
    shape = ('all', 'gaps', 'none')[int(seed or 0) % 3]
    return DUMMY_PLAYER_STATS[f"{_STUB_ROLE_OF.get(role, 'batter')}-{shape}"]

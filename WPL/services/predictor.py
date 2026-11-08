"""The instant season predictor: play the rest of the WPL out, as often as you like.

Nothing here writes. The page hands back a set of picks - "RCBW beat MIW", "match
14 was a no result", "GG 180/5 chasing 176/8" - and this answers with the table
those picks produce and a fresh Monte-Carlo of everything still unpicked. The
admin result path (services/results.py) is the only thing that may touch a
fixture or the points table, and the predictor deliberately shares none of it.

The table is rebuilt from the fixture list every time rather than started from
the stored Pointstable, because a simulator has to let you replay a match that
has already happened - "what if MIW had chased that down?" - and you cannot take
a result back out of a total that has already absorbed it. Each completed match
contributes through pointstable._booked(), the same rule the real table uses, so
with nothing overridden the rebuild reproduces the live standings exactly.
Overriding one swaps that match's contribution for yours.

Speed is the feature. simulate() is built to answer inside a few hundred
milliseconds so the page can re-run on every click, which it buys by scaling the
simulation count to how much season is left (see SIM_BUDGET) rather than running
the 500k the hourly refresh can afford to. A twenty-match league is short enough
that it usually lands at the ceiling rather than the floor.
"""
import time

from .. import db
from ..models import Pointstable, Fixture
from ..config import pofs, full_name, clr, teamID, PLAYOFF_SPOTS
from ..utils.overs import ovToPer
from .playoffs import (calibrate_match_model, simulate_season, match_win_prob,
                       home_venue_map, innings_observations)
from .pointstable import _booked

# Sims are shared out so the wall clock stays roughly flat however much season
# is left. Measured best-of-five on a laptop, the cost fits
#     ms = 372 * sims * matches / 1e6  +  768 * sims / 1e6
# - nearly all of it per simulated match, plus a fixed per-simulation part (the
# ranking sort, the win-count tables, the bracket) worth about two extra
# matches. So the budget divides by remaining + SIM_OVERHEAD, and the ceiling
# matters: without it a near-finished season asks for far more simulations than
# it needs and spends a second and a half proving a result it already knows.
SIM_BUDGET = 1_100_000        # simulations x (remaining matches + overhead)
SIM_OVERHEAD = 2
SIM_MIN, SIM_MAX = 15_000, 60_000   # standard error 0.40 .. 0.20 percentage points
IMPACT_FRACTION = 0.5         # impact analysis runs two sims, so halve each

PLAYOFF_ORDER = ['E', 'F']
OVERS = 20                    # a side bowled out is deemed to have faced its full allocation

_MODEL_CACHE = {}


def _sim_count(remaining, fraction=1.0):
    if remaining <= 0:
        return 1
    share = SIM_BUDGET / (remaining + SIM_OVERHEAD)
    return int(max(SIM_MIN, min(SIM_MAX, share)) * fraction)


def _model_signature():
    """Cheap fingerprint of everything calibrate_match_model() reads."""
    row = db.session.query(
        db.func.count(Fixture.id), db.func.max(Fixture.id),
        db.func.sum(db.func.length(db.func.coalesce(Fixture.Result, '')))
    ).filter(Fixture.Result != None).one()
    return tuple(int(v or 0) for v in row)


def get_model(replay=False, skip=()):
    """The scoring model behind every simulated match.

    Normally this is the season's own fit - a ridge solve plus a dozen EM sweeps
    over every innings played.

    `skip` holds out the matches the reader has set aside, and this is the whole
    trick. Ask what might have happened over the last ten games of a finished
    season and the ratings, fitted on all twenty, already know exactly how those
    ten went: every "what if" collapses back onto what did happen. Fit on the ten
    that still stand and the other ten are genuinely open, which is the question
    being asked.

    Replaying the season is the limit of that: hold everything out. Feeding
    calibrate_match_model() no observations returns the priors untouched, so
    every side has the same attack and defence - and with the WPL at neutral
    grounds there is nothing left to tell two fixtures apart, so every tie in a
    replayed season is an even-money one.

    The fit costs well under a millisecond against a simulation's few hundred,
    so it is done per request and only the common cases are cached.
    """
    sig = _model_signature()
    key = ('prior' if replay else 'fit', sig, frozenset(skip or ()))
    if key not in _MODEL_CACHE:
        if len(_MODEL_CACHE) > 24:              # a reader can hold out any subset
            _MODEL_CACHE.clear()
        home_of = home_venue_map()
        obs = [] if replay else innings_observations(home_of, skip=key[2])
        _MODEL_CACHE[key] = calibrate_match_model(observations=obs, home_of=home_of)
    return _MODEL_CACHE[key]


# --------------------------------------------------------------------- state

def _score_of(info):
    info = info if isinstance(info, dict) else {}
    return {'runs': info.get('runs') or 0, 'wkts': info.get('wkts') or 0,
            'overs': info.get('overs') or 0.0}


def _tally(fx):
    """What one completed match puts on the table: the points and the innings.

    'nrr' says whether the two innings count towards net run rate. A no result
    is two different things here - an abandoned match never produced a pair of
    innings to count, while a tie the super over could not settle was played out
    in full and does count - and the result line is what tells them apart.
    """
    if fx.Win_T is None:
        return None
    a_info, b_info = fx.A_info or {}, fx.B_info or {}
    booked = {'a': _booked(a_info), 'b': _booked(b_info)}
    if fx.Win_T == 'NA':
        return dict(booked, w='NR', nrr=(fx.Result or '').startswith('Match tied'))
    return dict(booked, w=fx.Win_T, nrr=True)


def get_state():
    """Everything the page needs once: fixtures, the live table, team colours.

    Win probabilities ride along per fixture so the bars are drawn before the
    first simulation comes back.
    """
    model = get_model()
    prior = get_model(replay=True)
    playoff_nos = list(pofs.values())
    rows = Fixture.query.order_by(Fixture.id).all()

    league, playoffs = [], []
    for fx in rows:
        decided = fx.Win_T is not None
        entry = {
            'no': fx.Match_No,
            'a': fx.Team_A, 'b': fx.Team_B,
            'venue': (fx.Venue or '').split(', ')[-1],
            'date': fx.Date.strftime('%d %b %Y') if fx.Date else '',
            'played': decided,
            'winner': fx.Win_T,
            'result': fx.Result or '',
            'a_score': _score_of(fx.A_info), 'b_score': _score_of(fx.B_info),
        }
        if fx.Match_No in playoff_nos:
            playoffs.append(entry)
        else:
            # two prices: what this season says, and what a season nobody has
            # played says. Replay mode shows the second, and the page is given
            # both so flipping the toggle costs no round trip.
            entry['wp'] = round(match_win_prob(model, fx.Team_A, fx.Team_B, fx.Venue), 4)
            entry['wp0'] = round(match_win_prob(prior, fx.Team_A, fx.Team_B, fx.Venue), 4)
            entry['tally'] = _tally(fx)
            league.append(entry)

    table = Pointstable.query.order_by(
        Pointstable.Points.desc(), Pointstable.W.desc(),
        Pointstable.NRR.desc(), Pointstable.id.asc()).all()
    base = [{'team': t.team_name, 'p': t.P, 'w': t.W, 'l': t.L, 'nr': t.NR,
             'pts': t.Points, 'nrr': t.NRR,
             'for': dict(t.For or {}), 'against': dict(t.Against or {})} for t in table]

    return {
        'teams': {t['team']: {'name': full_name.get(t['team'], t['team']),
                              'clr': clr.get(t['team'], {})} for t in base},
        'order': [t['team'] for t in base],
        'league': league, 'playoffs': playoffs, 'base': base,
        'playoff_labels': pofs,
        'spots': PLAYOFF_SPOTS,
        'unplayed': sum(1 for m in league if not m['played']),
    }


# ----------------------------------------------------------------- the table

def _blank(team):
    return {'team': team, 'p': 0, 'w': 0, 'l': 0, 'nr': 0, 'pts': 0,
            'rf': 0.0, 'of': 0.0, 'ra': 0.0, 'ob': 0.0}


def _apply_score(row, side, other):
    """Add one predicted innings pair to a team's run-rate totals.

    Only counted when the page sent scores for both sides - a pick on its own
    says who won, not by how much, and inventing a margin would move net run
    rate on no evidence. A side bowled out is credited with its full allocation,
    the same rule the real points table uses.
    """
    if not side or not other:
        return
    faced = OVERS if side.get('wkts') == 10 else min(side.get('overs') or 0.0, OVERS)
    bowled = OVERS if other.get('wkts') == 10 else min(other.get('overs') or 0.0, OVERS)
    if faced <= 0 or bowled <= 0:
        return
    row['rf'] += side.get('runs') or 0
    row['of'] += faced
    row['ra'] += other.get('runs') or 0
    row['ob'] += bowled


def _award(a_row, b_row, choice):
    """Points, wins and losses for one match. Returns nothing; mutates the rows."""
    a_row['p'] += 1
    b_row['p'] += 1
    if choice == 'NR':
        a_row['nr'] += 1
        b_row['nr'] += 1
        a_row['pts'] += 1
        b_row['pts'] += 1
        return
    win, lose = (a_row, b_row) if choice == 'a' else (b_row, a_row)
    win['w'] += 1
    win['pts'] += 2
    lose['l'] += 1


def build_table(picks, state=None, replay=False):
    """The standings a set of picks produces, rebuilt from the fixture list.

    picks is {match_no: {'w': 'RCBW' | 'NR', 'open': true,
                         'a': {runs, wkts, overs}, 'b': {...}}}
    and overrides any match, played or not - replaying a completed one is the
    point of a simulator.

    Three states, then. A match with a 'w' takes that result. A match marked
    'open' has its real result set aside and is simulated like any unplayed one
    - which is what the per-match Re-predict button means, and without it that
    button could only ever re-show a result that was still being counted.
    Anything else falls back to what really happened, or is simulated if it has
    not been played.

    replay=True drops the real results altogether, so the season starts from an
    empty table and every match is either picked or simulated. Half a season in,
    that is the difference between one click and ten.
    """
    state = state or get_state()
    rows = {t['team']: _blank(t['team']) for t in state['base']}

    used, remaining = {}, []
    for m in state['league']:
        a_row, b_row = rows.get(m['a']), rows.get(m['b'])
        pick = (picks or {}).get(m['no']) or {}
        choice = pick.get('w')
        mine = choice in (m['a'], m['b'], 'NR')

        if a_row is None or b_row is None:          # a TBA playoff-style fixture
            continue
        if not mine and (replay or pick.get('open') or not m['played']):
            remaining.append((m['a'], m['b'], m['venue']))
            continue

        if mine:
            used[m['no']] = choice
            _award(a_row, b_row, 'NR' if choice == 'NR' else ('a' if choice == m['a'] else 'b'))
            # scores are optional: a pick says who won, not by how much, and
            # inventing a margin would move net run rate on no evidence
            _apply_score(a_row, pick.get('a'), pick.get('b'))
            _apply_score(b_row, pick.get('b'), pick.get('a'))
            continue

        t = m.get('tally')
        if not t:
            continue
        _award(a_row, b_row, 'NR' if t['w'] == 'NR' else ('a' if t['w'] == m['a'] else 'b'))
        if t['nrr']:
            _book(a_row, t['a'], t['b'])
            _book(b_row, t['b'], t['a'])

    for row in rows.values():
        scored = row['rf'] / row['of'] if row['of'] else 0.0
        conceded = row['ra'] / row['ob'] if row['ob'] else 0.0
        row['nrr'] = round(scored - conceded, 3) if (row['of'] and row['ob']) else 0.0

    ranked = sorted(rows.values(), key=lambda r: (-r['pts'], -r['w'], -r['nrr'], r['team']))
    return ranked, remaining, used


def _book(row, mine, theirs):
    """Add an already-booked (runs, overs) pair straight onto a team's totals."""
    row['rf'] += mine[0]
    row['of'] += ovToPer(mine[1])
    row['ra'] += theirs[0]
    row['ob'] += ovToPer(theirs[1])


# ------------------------------------------------------------------ scenarios

def _nrr_margin(row, remaining, target, mean_score):
    """How much a side must win each remaining match by to reach a target NRR.

    Net run rate is (runs for / overs faced) - (runs against / overs bowled).
    Win the next `remaining` matches by d runs apiece, with both innings going
    the full twenty, and the difference of the two totals grows by d each time
    while both over counts grow by twenty:

        target = (RF - RA + remaining*d) / (overs + 20*remaining)

    which rearranges to the d below. It is an approximation - a chase that ends
    early books fewer overs than twenty, which flatters the winner - so it reads
    as "about this much" and never as a promise.

    The overs-to-spare twin is the same margin seen from the other end. Chasing
    `t` with v overs unused scores at t/(20-v) instead of t/20, and setting that
    gain equal to d/20 gives v = 20d / (t + d) with t the par score.
    """
    overs = (row['of'] + row['ob']) / 2.0
    diff = row['rf'] - row['ra']
    if remaining <= 0:
        return None, None
    runs = (target * (overs + 20.0 * remaining) - diff) / remaining
    if runs <= 0:
        return 0, 0
    runs = int(round(runs))
    spare = 20.0 * runs / max(mean_score + runs, 1.0)
    return runs, round(spare, 1)


def _scenario(odds, row, remaining, sim, model):
    """What this side has to do, in the terms a supporter would ask it.

    `remaining` is its own games left, not the league's - "1 of 2" is a thing
    you can act on, "1 of 17" is not.

    by_wins is (total wins, share of sims, qualification rate within them), so
    the curve says what each finishing win count is worth. Reading it from the
    top gives the four cases that matter: through already, a win count that
    locks it in, winning out being enough, and winning out still not being
    enough - which is where other results and net run rate come in. A side that
    never makes the three in any branch, however it finishes, is out.
    """
    out = {'need': None, 'remaining': remaining, 'nrr_ok': True,
           'need_text': '', 'nrr_text': '', 'note': '', 'alive': True}

    if remaining <= 0:
        through = odds.get('qual', 0.0) >= 50
        out.update(need=0, alive=through, nrr_ok=through,
                   need_text='Qualified' if through else 'Eliminated',
                   nrr_text='Qualified' if through else 'Eliminated',
                   note=('Through to the playoffs - every match played.' if through else
                         'All matches played; the top three is out of reach.'))
        return out

    curve = [(w, share, rate) for w, share, rate in odds.get('by_wins', []) if share >= 0.0015]
    if not curve:
        out.update(need_text='Not enough simulations', nrr_text='—')
        return out

    max_w = max(w for w, _s, _r in curve)
    best_rate = max(r for _w, _s, r in curve)
    win_all_rate = max((r for w, _s, r in curve if w >= row['w'] + remaining), default=best_rate)
    secure = [w for w, _s, r in curve if r >= 0.995]
    mean_score = model.get('mean', 158.0)
    target = sim.get('cut_nrr', 0.0)

    # --- out of it ---------------------------------------------------------
    if best_rate <= 0.0005:
        out.update(need=None, alive=False, nrr_ok=False,
                   need_text='Eliminated', nrr_text='Eliminated',
                   note='No route to the top three, even winning every remaining match.')
        return out

    # --- a win count that settles it --------------------------------------
    if secure:
        need = max(min(secure) - row['w'], 0)
        out.update(need=need, nrr_ok=True)
        if need == 0:
            out['need_text'] = 'Already through'
            out['note'] = 'Qualification is secure whatever happens from here.'
        elif need >= remaining:
            out['need_text'] = 'Win all {}'.format(remaining)
            out['note'] = 'Winning every remaining match qualifies regardless of other results.'
        else:
            out['need_text'] = '{} of {} wins locks it in'.format(need, remaining)
            out['note'] = ('{} more win{} is enough on its own; anything beyond that is '
                           'seeding - and first place is a bye into the Final.'.format(
                               need, '' if need == 1 else 's'))
        out['nrr_text'] = 'Current NRR sufficient'
        return out

    # --- winning out is the best it can do, and it is not certain ----------
    need = max(max_w - row['w'], 0)
    out.update(need=need, nrr_ok=False)
    out['need_text'] = 'Win all {} + need help'.format(remaining)

    runs, spare = _nrr_margin(row, remaining, target, mean_score)
    if runs is None or runs <= 0:
        out['nrr_ok'] = True
        out['nrr_text'] = 'Current NRR sufficient'
    else:
        out['nrr_text'] = 'Win by ~{} runs or ~{} overs to spare each match'.format(
            runs, ('%g' % spare))
    out['note'] = ('Winning out reaches {:.0f}% - the rest is other results, and net run '
                   'rate decides a tie on points (the third side typically finishes on '
                   '{:+.2f}).'.format(win_all_rate * 100, target))
    return out


# ------------------------------------------------------------------ simulate

def simulate(picks=None, sims=None, detail=True, replay=False):
    """The whole answer for one set of picks: table, odds and scenarios."""
    started = time.perf_counter()
    state = get_state()
    picks = picks or {}
    # Results the reader has taken off the board, either by picking a different
    # one or by opening the match. They must not feed the ratings - see
    # get_model() - and they are also what makes the season hypothetical, so a
    # real playoff result stops meaning anything once any of them exist.
    held = {m['no'] for m in state['league'] if m['played']
            and ((picks.get(m['no']) or {}).get('w')
                 or (picks.get(m['no']) or {}).get('open'))}
    model = get_model(replay, held)
    ranked, remaining, used = build_table(picks, state, replay)

    teams_in = {r['team']: {'points': r['pts'], 'wins': r['w'], 'runs_for': r['rf'],
                            'overs_faced': r['of'], 'runs_against': r['ra'],
                            'overs_bowled': r['ob']} for r in ranked}
    count = _sim_count(len(remaining)) if sims is None else sims
    sim = simulate_season(teams_in, remaining, model=model, sims=count, detail=detail)
    odds = sim['teams']

    left = {}
    for a, b, _venue in remaining:
        left[a] = left.get(a, 0) + 1
        left[b] = left.get(b, 0) + 1

    rows = []
    for pos, r in enumerate(ranked, start=1):
        o = odds.get(r['team'], {})
        row = dict(r, pos=pos, qual=o.get('qual', 0.0), top1=o.get('top1', 0.0),
                   title=o.get('title', 0.0),
                   seeds=o.get('seeds', []), left=left.get(r['team'], 0))
        if detail:
            row['scenario'] = _scenario(o, r, left.get(r['team'], 0), sim, model)
        rows.append(row)

    return {
        'table': rows,
        'remaining': len(remaining),
        'picked': used,
        'spots': PLAYOFF_SPOTS,
        'sims': count if remaining else 0,
        'ms': int((time.perf_counter() - started) * 1000),
        'replay': bool(replay),
        'held': sorted(held),
        'cut_nrr': round(sim.get('cut_nrr', 0.0), 3),
        'bracket': bracket(ranked, picks, state, model, len(remaining),
                           replay or bool(held)),
    }


def bracket(ranked, picks, state, model, open_matches, hypothetical=False):
    """The playoff bracket for the predicted top three.

    Two ties: the Eliminator between second and third, then the Final, where the
    team that finished first is already waiting. That bye is the whole shape of
    this format, so the Final's first slot is filled from the seeding rather
    than from a tie that was played to earn it.

    The seeding is only meaningful once every league match has an answer, which
    here means played or picked - until then these are the sides currently in
    the three, not the ones that will be, and the page says so. Each tie carries
    the model's own price, and a pick on a playoff fixture overrides it.

    A real playoff result is only worth anything when the league that produced
    it still stands and the two sides here are the two that actually contested
    it. Change one league result and the road to the Final changed with it, so
    last season's winner must not be handed the trophy in a bracket it may not
    even be in - `hypothetical` says that has happened.
    """
    seeds = [r['team'] for r in ranked[:PLAYOFF_SPOTS]]
    if len(seeds) < PLAYOFF_SPOTS:
        return {'seeded': False, 'ties': []}

    labels = {v: k for k, v in pofs.items()}
    by_label = {labels.get(m['no']): m for m in state['playoffs'] if labels.get(m['no'])}

    def tie(key, a, b, title):
        m = by_label.get(key) or {}
        no = m.get('no', pofs.get(key, key))
        pick = (picks.get(no) or {}).get('w')
        # the stored fixture only describes this tie if the league behind it is
        # untouched and the two sides here are the two that played it
        same = (not hypothetical and m.get('played') and a and b
                and {m.get('a'), m.get('b')} == {a, b})
        winner = m.get('winner') if same else (pick if pick in (a, b) else None)
        return {'key': key, 'no': no, 'title': title, 'a': a, 'b': b,
                'venue': m.get('venue', ''), 'date': m.get('date', ''),
                'played': bool(same), 'winner': winner,
                'wp': round(match_win_prob(model, a, b, neutral=True), 4) if a and b else 0.5}

    el = tie('E', seeds[1], seeds[2], 'Eliminator')
    f = tie('F', seeds[0], el['winner'], 'Final')

    return {'seeded': True, 'provisional': open_matches > 0,
            'seeds': seeds, 'ties': [el, f]}


def impact(match_no, picks=None, replay=False):
    """What one result would do to everyone's qualification odds.

    Run twice with the match forced each way, at half the usual count each so the
    pair costs about what one normal refresh does, and report the gap. In a
    five-team league a side that is not playing can move a long way on someone
    else's result, which is the whole reason the button exists.
    """
    state = get_state()
    match = next((m for m in state['league'] if m['no'] == match_no), None)
    if match is None:
        return {'ok': False}

    picks = dict(picks or {})
    # the match being weighed is itself held out, along with anything else the
    # reader has set aside, so neither side is priced on a result being undone
    held = {m['no'] for m in state['league'] if m['played']
            and ((picks.get(m['no']) or {}).get('w')
                 or (picks.get(m['no']) or {}).get('open'))}
    if match['played']:
        held.add(match_no)
    model = get_model(replay, held)
    out = {}
    for side in (match['a'], match['b']):
        forced = dict(picks)
        forced[match_no] = dict(forced.get(match_no) or {}, w=side)
        ranked, remaining, _ = build_table(forced, state, replay)
        teams_in = {r['team']: {'points': r['pts'], 'wins': r['w'], 'runs_for': r['rf'],
                                'overs_faced': r['of'], 'runs_against': r['ra'],
                                'overs_bowled': r['ob']} for r in ranked}
        odds = simulate_season(teams_in, remaining, model=model,
                               sims=_sim_count(len(remaining), IMPACT_FRACTION))['teams']
        out[side] = {t: o['qual'] for t, o in odds.items()}

    a, b = match['a'], match['b']
    swing = sorted(
        ({'team': t, 'a': out[a][t], 'b': out[b][t], 'swing': round(out[a][t] - out[b][t], 1)}
         for t in out[a]),
        key=lambda s: -abs(s['swing']))
    return {'ok': True, 'match': match_no, 'a': a, 'b': b, 'swing': swing}

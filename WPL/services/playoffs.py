"""Playoff qualification: fit the season's scoring model, then simulate it out.

refresh_qualification() is the entry point - it is run hourly by the scheduler
and again in the background whenever a result is added or removed.

The WPL format is a short one and that changes what the maths has to say. Five
teams play a single round robin of twenty matches, three go through, and the
bracket is only two ties deep: the Eliminator between second and third, then the
Final between the table-topper and whoever survives it. Finishing first is worth
far more than it is in a four-team bracket - it is a bye into the Final - so
`top1` is reported alongside the qualification chance rather than `top2`.
"""
import math
import numpy as np
from collections import defaultdict, Counter

from .. import db
from ..models import Pointstable, Fixture
from ..config import pofs, teams_data, PLAYOFF_SPOTS, HOME_ADVANTAGE
from ..utils.overs import ovToPer

# ------------------------------------------------------------------ playoff simulation
# WPL: 5 teams, 20 league matches (single round-robin), top 3 into the playoffs.
SIMULATIONS = 500_000   # numpy-vectorised, so this is cheap: SE <= 0.07 percentage points
SIM_CHUNK = 5_000       # sims per batch: keeps the working set in cache, and caps
                        # peak memory whatever SIMULATIONS is set to
SIM_SEED = 20260109     # fixed seed => an unchanged points table always gives the same %

OVERS = 20              # a side bowled out is still deemed to have faced its full 20
PROB_NR = 0.022         # washout rate: a January season loses very few matches

# Priors for the scoring model. calibrate_match_model() moves these toward whatever
# this season's completed matches say; with no matches played it returns them unchanged.
PRIOR_MEAN_SCORE = 158.0   # runs per innings - the WPL scores below the men's game
PRIOR_STD_DEV = 32.0       # per-innings SD, a touch wider than the IPL's
PRIOR_HOME_ADV = 0.0       # the whole season is at neutral grounds
RIDGE_MEAN = 4.0           # shrinkage weights, in "pseudo-innings" of prior evidence
RIDGE_TEAM = 6.0           # five sides over twenty matches, so a side's own form
                           # has to carry further than it would across an IPL season
RIDGE_HOME = 25.0
RIDGE_CHASE = 25.0
SIGMA_PRIOR_WEIGHT = 25.0
EM_ITERS = 12              # EM sweeps for the censored-chase likelihood
SCORE_FLOOR, SCORE_CEIL = 50, 280
RATING_CAP = 25.0          # runs, hard cap on a team's attack/defence rating
CHASE_PACING = 0.64        # a chasing side paces itself, so only part of its spare capacity

def _mills_ratio(a):
    """phi(a) / (1 - Phi(a)) - the expected overshoot of a normal draw above a.

    Used to fill in the scores of successful chases, which are only ever observed
    as ">= the target". Arrays here are at most a few hundred long, so the
    per-element loop costs nothing and saves a scipy dependency.
    """
    out = np.empty(len(a), dtype=float)
    for k, v in enumerate(a):
        tail = 0.5 * math.erfc(v / math.sqrt(2.0))
        out[k] = (v + 1.0 / v) if tail < 1e-12 else (
            math.exp(-0.5 * v * v) / math.sqrt(2.0 * math.pi) / tail)
    return out

def home_venue_map():
    """{venue: home team}, derived from the fixture list rather than hard-coded.

    Empty for the WPL, and deliberately so. The season is played at two neutral
    grounds, so the side listed first in the fixture sheet is not hosting
    anything - reading a host off it would hand whoever happens to be listed
    first at Vadodara an advantage nobody actually has. season.home_advantage in
    config.json is what switches this; turn it on and the IPL rule applies, where
    the host is whichever team is listed first at a venue most often, which keeps
    secondary home grounds right.
    """
    if not HOME_ADVANTAGE:
        return {}
    rows = db.session.query(Fixture.Venue, Fixture.Team_A).filter(
        Fixture.Match_No.notin_(list(pofs.values()))).all()
    hosts = defaultdict(Counter)
    for venue, team_a in rows:
        if venue and team_a:
            hosts[venue][team_a] += 1
    return {venue: counter.most_common(1)[0][0] for venue, counter in hosts.items()}

def innings_observations(home_of, skip=()):
    """One row per completed league innings, as
    (batting, bowling, is_home, is_chase, runs, censor_at).

    `skip` drops matches by Match_No. The predictor uses it to hold out the
    results a reader has set aside: asking what might have happened in the last
    ten matches, while the ratings still quietly know how those ten went,
    answers a different and much less interesting question.

    censor_at is None when the innings was seen in full, or the target when the
    chase succeeded - the side stopped batting on reaching it, so all we know is
    that its notional 20-over total was at least that high. Modelling that
    censoring is what lets every innings inform the ratings without the sample
    being skewed by winning chases stopping early.

    Super overs, DLS and abandoned matches are skipped: for those the innings
    total either isn't attributable to a batting order or isn't a 20-over score.
    """
    fixtures = Fixture.query.filter(Fixture.Result != None).filter(
        Fixture.Match_No.notin_(list(pofs.values()))).order_by(Fixture.id).all()
    skip = set(skip or ())
    rows = []
    for fx in fixtures:
        res = fx.Result or ''
        if fx.Match_No in skip:
            continue
        if fx.Win_T in (None, 'NA') or 'Super over' in res or 'DLS' in res or 'abandoned' in res:
            continue
        if 'wicket' in res:        # the winner chased, so it batted second
            first, second = (fx.Team_B, fx.Team_A) if fx.Win_T == fx.Team_A else (fx.Team_A, fx.Team_B)
        elif 'run' in res:         # the winner defended, so it batted first
            first, second = (fx.Team_A, fx.Team_B) if fx.Win_T == fx.Team_A else (fx.Team_B, fx.Team_A)
        else:
            continue
        info = {fx.Team_A: fx.A_info or {}, fx.Team_B: fx.B_info or {}}
        r1, r2 = info[first].get('runs'), info[second].get('runs')
        if not r1 or not r2:
            continue
        # No host at a neutral ground, so home_of has no entry and both of these
        # are False - which is what the fitted home term should see.
        home = home_of.get(fx.Venue)
        rows.append((first, second, first == home, False, r1, None))
        rows.append((second, first, second == home, True, r2, r1 + 1 if r2 > r1 else None))
    return rows

def calibrate_match_model(observations=None, home_of=None):
    """Fit this season's scoring model: innings runs ~ mean + attack + defence + home + chase.

    A ridge penalty pulls every coefficient toward its prior, weighted in
    pseudo-innings, so the fit degrades gracefully: no matches played returns the
    priors exactly, and team ratings only move as far as the results justify.
    Successful chases enter as right-censored observations, handled by EM.
    """
    home_of = home_venue_map() if home_of is None else home_of
    obs = innings_observations(home_of) if observations is None else observations

    names = list(teams_data)
    idx = {t: k for k, t in enumerate(names)}
    obs = [o for o in obs if o[0] in idx and o[1] in idx]
    n_t = len(names)
    n_col = 3 + 2 * n_t                      # mean | attack(5) | defence(5) | home | chase

    X = np.zeros((len(obs), n_col))
    y = np.zeros(len(obs))
    cens = np.full(len(obs), np.nan)
    for k, (bat, bowl, is_home, is_chase, runs, censor_at) in enumerate(obs):
        X[k, 0] = 1.0
        X[k, 1 + idx[bat]] = 1.0
        X[k, 1 + n_t + idx[bowl]] = 1.0
        X[k, -2] = 1.0 if is_home else 0.0
        X[k, -1] = 1.0 if is_chase else 0.0
        y[k] = runs
        if censor_at is not None:
            cens[k] = censor_at

    penalty = np.concatenate(([RIDGE_MEAN], np.full(2 * n_t, RIDGE_TEAM), [RIDGE_HOME, RIDGE_CHASE]))
    prior = np.concatenate(([PRIOR_MEAN_SCORE], np.zeros(2 * n_t), [PRIOR_HOME_ADV, 0.0]))
    normal_eq = X.T @ X + np.diag(penalty)   # ridge diagonal keeps this solvable at n = 0
    target = penalty * prior

    beta = np.linalg.solve(normal_eq, X.T @ y + target)
    sigma = PRIOR_STD_DEV
    censored = ~np.isnan(cens)
    for _ in range(EM_ITERS):
        fit = X @ beta
        work = y.copy()
        sq = np.empty(len(obs))
        sq[~censored] = (y[~censored] - fit[~censored]) ** 2
        if censored.any():
            a = (cens[censored] - fit[censored]) / sigma
            ratio = _mills_ratio(a)
            work[censored] = fit[censored] + sigma * ratio      # E[runs | runs >= target]
            sq[censored] = sigma ** 2 * (1.0 + a * ratio)       # and its second moment
        sigma = math.sqrt((sq.sum() + SIGMA_PRIOR_WEIGHT * PRIOR_STD_DEV ** 2)
                          / (len(obs) + SIGMA_PRIOR_WEIGHT))
        beta = np.linalg.solve(normal_eq, X.T @ work + target)

    # With no home grounds to fit, the home column is all zeroes and the term
    # never leaves its prior; pinning it keeps a stray ridge wobble out of the
    # simulation rather than relying on that.
    home_adv = float(np.clip(beta[-2], -15.0, 25.0)) if HOME_ADVANTAGE else 0.0

    return {
        'mean': float(beta[0]),
        'sigma': float(np.clip(sigma, 18.0, 48.0)),
        'attack': {t: float(np.clip(beta[1 + k], -RATING_CAP, RATING_CAP)) for t, k in idx.items()},
        'defence': {t: float(np.clip(beta[1 + n_t + k], -RATING_CAP, RATING_CAP)) for t, k in idx.items()},
        'home_adv': home_adv,
        'chase_adj': float(np.clip(beta[-1], -20.0, 20.0)),
        'home_of': home_of,
        'innings': len(obs),
    }

def _pct(count, total):
    """Percentage, keeping 'impossible' and 'merely unlikely' visibly different.

    Returns a plain float - a numpy scalar would reach psycopg2 unadaptable.
    """
    if count <= 0:
        return 0.0
    if count >= total:
        return 100.0
    return float(min(99.9, max(0.1, round(count / total * 100.0, 1))))

def _norm_cdf(x):
    return 0.5 * math.erfc(-x / math.sqrt(2.0))

def match_win_prob(model, a, b, venue=None, neutral=False):
    """P(a beats b), straight off the scoring model rather than by simulation.

    Both innings are normal draws, so the margin between them is normal too and
    the probability is a single Phi(). Who chases is a coin toss and the chase
    adjustment follows whoever bats second, so the two cases are averaged.
    """
    attack, defence = model['attack'], model['defence']
    exp_a = model['mean'] + attack.get(a, 0.0) + defence.get(b, 0.0)
    exp_b = model['mean'] + attack.get(b, 0.0) + defence.get(a, 0.0)
    if not neutral:
        home = model.get('home_of', {}).get(venue)
        exp_a += model['home_adv'] if home == a else 0.0
        exp_b += model['home_adv'] if home == b else 0.0
    sd = model['sigma'] * math.sqrt(2.0)
    chase, d = model['chase_adj'], exp_a - exp_b
    return 0.5 * _norm_cdf((d - chase) / sd) + 0.5 * _norm_cdf((d + chase) / sd)

def _win_matrix(model, names):
    """P(row beats column) for every pair, at a neutral venue. For the bracket."""
    n = len(names)
    out = np.full((n, n), 0.5)
    for i, a in enumerate(names):
        for j, b in enumerate(names):
            if i != j:
                out[i, j] = match_win_prob(model, a, b, neutral=True)
    return out

def simulate_season(teams, remaining_matches, model=None, sims=None, detail=False):
    """Monte-Carlo the rest of the league, and the bracket after it.

    teams:             {team: {points, wins, runs_for, overs_faced, runs_against, overs_bowled}}
                       with overs as DECIMAL overs (run ovToPer() on the stored x.y values).
                       Iteration order breaks exact ties, so pass it ranked.
    remaining_matches: (team_a, team_b) or (team_a, team_b, venue) rows, league matches only.

    Each simulated match plays out as a real one: a first innings of 20 overs, then
    a chase that either falls short over the full 20 or gets there early - which is
    what moves net run rate, and net run rate is what settles most cut-offs. Teams
    are ranked on points, then wins, then NRR, matching both the WPL playing
    conditions and the table this feeds.

    Returns {'teams': {team: {...}}} plus, under detail, the season-wide figures
    that belong to no single side.

    detail=True also returns what the predictor page needs and the hourly refresh
    does not, so it is kept behind the flag: where each side finishes, who lifts
    the trophy, qualification rate broken down by final win count - which is what
    turns a percentage into "6 of 8 wins needed" - and the net run rate the side
    taking the last playoff place ended on, which is the bar a team chasing on
    net run rate has to clear.
    """
    names = list(teams)
    n_t = len(names)
    idx = {t: k for k, t in enumerate(names)}
    # Three of five, but never more places than there are sides to fill them
    spots = max(1, min(PLAYOFF_SPOTS, n_t))
    last = spots - 1                      # index of the final qualifying place
    if model is None:
        model = calibrate_match_model()
    mu, sigma = model['mean'], model['sigma']
    attack, defence = model['attack'], model['defence']
    home_adv, chase_adj = model['home_adv'], model['chase_adj']
    home_of = model.get('home_of', {})

    # Resolve each fixture's expected scores once, outside the simulation loop.
    fixtures = []
    for m in remaining_matches:
        a, b, venue = m[0], m[1], (m[2] if len(m) > 2 else None)
        if a not in idx or b not in idx:
            continue
        home = home_of.get(venue)
        exp_a = mu + attack.get(a, 0.0) + defence.get(b, 0.0) + (home_adv if home == a else 0.0)
        exp_b = mu + attack.get(b, 0.0) + defence.get(a, 0.0) + (home_adv if home == b else 0.0)
        fixtures.append((idx[a], idx[b], exp_a, exp_b))

    base = {k: np.array([float(teams[t].get(k, 0) or 0) for t in names])
            for k in ('points', 'wins', 'runs_for', 'overs_faced', 'runs_against', 'overs_bowled')}

    want = SIMULATIONS if sims is None else max(1, int(sims))
    total = want if fixtures else 1            # nothing left to play => one deterministic pass
    rng = np.random.default_rng(SIM_SEED + len(fixtures))
    counts = np.zeros((n_t, 2))                # through to the playoffs | finished first
    # detail accumulators
    max_wins = int(base['wins'].max()) + len(fixtures) + 1
    seed_counts = np.zeros((n_t, spots))
    title_counts = np.zeros(n_t)
    wins_total = np.zeros((n_t, max_wins))
    wins_through = np.zeros((n_t, max_wins))
    cut_nrr = []                               # the last qualifier's NRR, one per sim
    pwin = _win_matrix(model, names) if detail else None
    done = 0
    while done < total:
        n = min(SIM_CHUNK, total - done)
        # Accumulators are (team, sim): one team's row is contiguous, so the eight
        # updates each match needs stay cache-friendly.
        pts, wins, runs_for, overs_faced, runs_against, overs_bowled = (
            np.repeat(base[k][:, None], n, axis=1) for k in
            ('points', 'wins', 'runs_for', 'overs_faced', 'runs_against', 'overs_bowled'))

        for i, j, exp_a, exp_b in fixtures:
            a_first = rng.random(n) < 0.5           # who bats first is close to a coin toss
            no_res = rng.random(n) < PROB_NR
            exp_1 = np.where(a_first, exp_a, exp_b)
            exp_2 = np.where(a_first, exp_b, exp_a) + chase_adj

            first = rng.standard_normal(n)
            first *= sigma
            first += exp_1
            np.rint(first, out=first)
            np.clip(first, SCORE_FLOOR, SCORE_CEIL, out=first)
            # What the chasing side would make in a full 20 overs; it only bats on
            # until the target, so this decides the result and how early it finishes.
            second = rng.standard_normal(n)
            second *= sigma
            second += exp_2
            np.rint(second, out=second)
            np.clip(second, SCORE_FLOOR - 20, SCORE_CEIL + 20, out=second)

            target = first + 1.0
            chased = second >= target
            over_hit = np.minimum(rng.integers(0, 5, n), np.maximum(second - target, 0.0))
            pace = np.clip(rng.standard_normal(n) * 0.07 + 1.0, 0.7, 1.15)
            spare = 1.0 - CHASE_PACING * (1.0 - target / np.maximum(second, 1.0))
            balls = np.clip(np.ceil(120.0 * spare * pace), 24, 120)
            runs_2 = np.where(chased, target + over_hit, second)
            # An innings that ends in defeat counts as the full 20 whether the side
            # was bowled out or simply ran out of overs.
            overs_2 = np.where(chased, balls / 6.0, float(OVERS))

            tied = (~chased) & (second == first)    # a tie goes to a super over, not shared points
            super_over = rng.random(n) < 0.5
            first_won = (~chased & ~tied) | (tied & super_over)
            a_won = np.where(a_first, first_won, chased | (tied & ~super_over)) & ~no_res
            b_won = (~no_res) & ~a_won

            pts[i] += np.where(no_res, 1.0, np.where(a_won, 2.0, 0.0))
            pts[j] += np.where(no_res, 1.0, np.where(b_won, 2.0, 0.0))
            wins[i] += a_won
            wins[j] += b_won

            live = ~no_res                          # a no-result leaves run rates untouched
            a_runs = np.where(a_first, first, runs_2) * live
            a_overs = np.where(a_first, float(OVERS), overs_2) * live
            b_runs = np.where(a_first, runs_2, first) * live
            b_overs = np.where(a_first, overs_2, float(OVERS)) * live
            runs_for[i] += a_runs
            overs_faced[i] += a_overs
            runs_against[i] += b_runs
            overs_bowled[i] += b_overs
            runs_for[j] += b_runs
            overs_faced[j] += b_overs
            runs_against[j] += a_runs
            overs_bowled[j] += a_overs

        scored = np.divide(runs_for, overs_faced, out=np.zeros_like(runs_for), where=overs_faced > 0)
        conceded = np.divide(runs_against, overs_bowled, out=np.zeros_like(runs_against), where=overs_bowled > 0)
        # One sort key for points > wins > NRR; the gaps are wide enough that the
        # lower-priority terms can never bleed into the higher ones.
        key = pts * -1e6 - wins * 1e3 - np.clip(scored - conceded, -400.0, 400.0)
        order = np.argsort(np.ascontiguousarray(key.T), axis=1, kind='stable')
        counts[:, 0] += np.bincount(order[:, :spots].ravel(), minlength=n_t)
        counts[:, 1] += np.bincount(order[:, 0], minlength=n_t)

        if detail:
            for p in range(spots):
                seed_counts[:, p] += np.bincount(order[:, p], minlength=n_t)

            # Where the cut fell: the net run rate of whoever squeezed into the
            # last playoff place. A side relying on NRR has to beat this number,
            # so it is what "win by about this much" is measured against.
            cut_nrr.append((scored - conceded)[order[:, last], np.arange(n)])

            # Qualification rate by final win count. Narrowing to the sims where
            # a side actually won w of them is what answers "how many do we
            # need?" - the flat percentage averages over every path at once.
            # Teams are folded into one index space (team * max_wins + wins) so
            # the whole table is two bincounts rather than two per side.
            through = np.zeros((n_t, n), dtype=bool)
            through[order[:, :spots].ravel(), np.repeat(np.arange(n), spots)] = True
            flat = np.arange(n_t)[:, None] * max_wins + wins.astype(np.int64)
            wins_total += np.bincount(flat.ravel(),
                                      minlength=n_t * max_wins).reshape(n_t, max_wins)
            wins_through += np.bincount(flat[through],
                                        minlength=n_t * max_wins).reshape(n_t, max_wins)

            # The bracket, which in this format is two ties: second plays third
            # to stay alive, then the survivor meets the table-topper in the
            # Final. Finishing first is a bye, which is why top1 is reported.
            s1, s2, s3 = order[:, 0], order[:, 1], order[:, 2]
            elim = np.where(rng.random(n) < pwin[s2, s3], s2, s3)
            champ = np.where(rng.random(n) < pwin[s1, elim], s1, elim)
            title_counts += np.bincount(champ, minlength=n_t)
        done += n

    out = {t: {'qual': _pct(counts[k, 0], total),
               'top1': _pct(counts[k, 1], total)} for t, k in idx.items()}
    if not detail:
        return {'teams': out}
    for t, k in idx.items():
        out[t]['title'] = _pct(title_counts[k], total)
        out[t]['seeds'] = [_pct(seed_counts[k, p], total) for p in range(spots)]
        # only win counts that actually came up, so the caller can read the
        # cliff edge straight off: [(wins, share of sims, qualification rate), ...]
        out[t]['by_wins'] = [
            (int(w), float(wins_total[k, w] / total), float(wins_through[k, w] / wins_total[k, w]))
            for w in range(max_wins) if wins_total[k, w] > 0]
    cut = np.concatenate(cut_nrr) if cut_nrr else np.zeros(1)
    return {'teams': out,
            # the median is the bar in a typical season; the upper quartile is
            # what it takes to be comfortable rather than lucky
            'cut_nrr': float(np.median(cut)),
            'cut_nrr_hi': float(np.percentile(cut, 75))}

def get_playoff_odds(teams, remaining_matches, model=None):
    """Qualification / finished-first percentages for the points table.

    See simulate_season(); this is the cheap pass, without the per-side detail
    the predictor page asks for.
    """
    return simulate_season(teams, remaining_matches, model=model)['teams']

def refresh_qualification():
    dataPT = Pointstable.query.order_by(Pointstable.Points.desc(),Pointstable.W.desc(),Pointstable.NRR.desc(),Pointstable.id.asc()).all()
    teams_in = {tm.team_name : {'points': tm.Points, 'wins': tm.W, 'runs_for': tm.For['runs'], 'overs_faced': ovToPer(tm.For['overs']), 'runs_against': tm.Against['runs'], 'overs_bowled': ovToPer(tm.Against['overs'])} for tm in dataPT}
    remaining_matches = db.session.query(Fixture.Team_A, Fixture.Team_B, Fixture.Venue).filter(Fixture.Result == None).filter(Fixture.Match_No.notin_(list(pofs.values()))).order_by(Fixture.id).all()
    odds = get_playoff_odds(teams_in, remaining_matches)
    for tm in dataPT:
        tm.Qual = odds[tm.team_name]['qual']
        tm.Top1 = odds[tm.team_name]['top1']
    db.session.commit()

def run_refresh_qualification_bg(app):
    with app.app_context():
        try:
            refresh_qualification()
            print("Qualification percentages updated.")
        except Exception as e:
            print(f"Error updating qualifications: {e}")

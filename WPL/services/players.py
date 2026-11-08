"""Resolving a feed's spelling of a player name against the Squad table."""
import re
import unicodedata
from collections import defaultdict

from fuzzywuzzy import fuzz

from ..config import teamID

# ------------------------------------------------------------------ player name matching
# The feeds spell players differently from the Squad table: initials instead of
# given names ("R Jadeja"), short forms ("Matt Short" for Matthew William Short),
# transliteration drift ("Mohd."/"Mohammad"/"Mohammed"), role markers appended to
# the name ("Shubman Gill (c)") and the odd accent. find_player() resolves a feed
# name against the squad with a cascade: exact, then structural (the surname is
# the anchor and the given names/initials have to stay consistent with it), then
# a surname-weighted fuzzy pass that only commits when the winner beats the
# runner-up by a clear margin. Anything still ambiguous returns None, and the
# caller keeps the feed's own spelling - a much smaller error than pinning a
# score on the wrong player.

_VOWELS = frozenset('aeiou')

# Prefixes that belong to the surname rather than to the given names, so that a
# feed's "de Kock" still lines up with "Quinton de Kock".
_PARTICLES = frozenset({'de', 'del', 'della', 'di', 'da', 'du', 'van', 'von',
                        'der', 'den', 'ten', 'ter', 'le', 'la', 'bin', 'ibn'})

# Transliterations the feeds use interchangeably. Applied per word, not as a
# substring replace - "Madhwal" must not turn into "Mohammedhwal".
_SPELLING_ALIASES = {
    'md': 'mohammed', 'mhd': 'mohammed', 'mohd': 'mohammed',
    'mohamad': 'mohammed', 'mohamed': 'mohammed', 'mohammad': 'mohammed',
    'muhammad': 'mohammed', 'muhammed': 'mohammed',
}

# Short forms the feeds like for overseas players. Folded to the long form on
# both sides, so "Matt Short" and "Matthew William Short" meet in the middle.
# Keys are short forms only; none of them is anybody's surname.
_NICKNAMES = {
    'alex': 'alexander', 'andy': 'andrew', 'ben': 'benjamin',
    'benny': 'benjamin', 'bill': 'william', 'billy': 'william',
    'chris': 'christopher', 'dan': 'daniel', 'danny': 'daniel',
    'dave': 'david', 'eddie': 'edward', 'greg': 'gregory', 'jake': 'jacob',
    'jim': 'james', 'jimmy': 'james', 'joe': 'joseph', 'jos': 'joseph',
    'josh': 'joshua', 'matt': 'matthew', 'matty': 'matthew',
    'mike': 'michael', 'mitch': 'mitchell', 'nick': 'nicholas',
    'pat': 'patrick', 'phil': 'philip', 'phillip': 'philip', 'rob': 'robert',
    'robbie': 'robert', 'sam': 'samuel', 'sammy': 'samuel',
    'stephen': 'steven', 'steve': 'steven', 'tim': 'timothy',
    'tom': 'thomas', 'tommy': 'thomas', 'tony': 'anthony', 'will': 'william',
    'zac': 'zachary', 'zach': 'zachary', 'zak': 'zachary',
}

_PAREN_RE = re.compile(r'\([^)]*\)?')   # closing bracket optional: feeds truncate
_NONALPHA_RE = re.compile(r'[^A-Za-z]+')


def _deaccent(text_value):
    """Fold accents away so "Mendis" matches "Méndis"."""
    return ''.join(c for c in unicodedata.normalize('NFKD', text_value)
                   if not unicodedata.combining(c))


def _canon_word(word):
    low = word.lower()
    low = _SPELLING_ALIASES.get(low, low)
    return _NICKNAMES.get(low, low)


def parse_name(name):
    """Break a player name into the pieces the matcher reasons about.

    Returns a dict with the normalised name ("m s dhoni"), its order-independent
    form, the surname, and the given-name "slots". A slot is (word, letter) for a
    spelled-out name and (None, letter) for an initial, which is what lets
    "R Jadeja", "RA Jadeja" and "Ravindra Jadeja" compare as the same person.
    """
    raw = _deaccent(str(name or ''))
    raw = _PAREN_RE.sub(' ', raw)                 # drop "(c)", "(wk)", "(sub)"
    words = _NONALPHA_RE.sub(' ', raw).split()    # also splits "T.Natarajan"
    shouty = raw.isupper()                        # some feeds SHOUT every name

    slots = []
    for word in words:
        low = word.lower()
        initial = (len(word) == 1
                   or (len(word) <= 3 and not _VOWELS & set(low))   # MS, KL, RS
                   or (len(word) <= 3 and word.isupper() and not shouty))
        if initial:
            slots.extend((None, ch) for ch in low)
        else:
            canon = _canon_word(word)
            slots.append((canon, canon[0]))

    # The surname is the last spelled-out word, with any particles glued on.
    last = max((i for i, (w, _) in enumerate(slots) if w), default=None)
    if last is None:
        surname = ''.join(ch for _, ch in slots)
        givens = []
    else:
        first = last
        while first > 0 and slots[first - 1][0] in _PARTICLES:
            first -= 1
        surname = ''.join(w for w, _ in slots[first:last + 1] if w)
        givens = slots[:first] + slots[last + 1:]

    key = ' '.join(w or ch for w, ch in slots)
    return {'key': key, 'sorted': ' '.join(sorted(key.split())),
            'tokens': frozenset(key.split()),
            'surname': surname, 'givens': givens, 'slots': slots}


def normalize_name(name):
    """Order-independent normalised form of a name, for cheap equality checks."""
    return parse_name(name)['sorted']


def _surname_ok(a, b):
    """Same surname allowing for transliteration, not merely a similar one."""
    if not a or not b:
        return False
    if a == b:
        return True
    if a[0] != b[0]:
        return False
    if len(a) >= 5 and len(b) >= 5 and (a.startswith(b) or b.startswith(a)):
        return True
    return fuzz.ratio(a, b) >= 90


def _slot_ok(a, b):
    """Can two given-name slots be the same name?"""
    word_a, letter_a = a
    word_b, letter_b = b
    if word_a and word_b:
        if word_a == word_b:
            return True
        short, long_ = sorted((word_a, word_b), key=len)
        return len(short) >= 3 and long_.startswith(short)   # Surya(kumar)
    return letter_a == letter_b


def _is_subseq(short, long_):
    """Does every slot of the shorter name line up, in order, on the longer one?"""
    i = 0
    for slot in long_:
        if i < len(short) and _slot_ok(short[i], slot):
            i += 1
    return i == len(short)


def _contains(a, b):
    """Same, either way round: one name written out more fully than the other."""
    return _is_subseq(a, b) if len(a) <= len(b) else _is_subseq(b, a)


def _spells_out(a, b):
    """Is one name the other with extra words, matched word for word?

    Like _contains(), but at least one pair has to be two spelled-out words.
    Without that, "Rasikh Salam" slots straight into the initials of
    "R S Ambrish" and comes back as a confident match.
    """
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    i = spelled = 0
    for slot in long_:
        if i < len(short) and _slot_ok(short[i], slot):
            spelled += bool(short[i][0] and slot[0])
            i += 1
    return i == len(short) and spelled > 0


def _givens_ok(a, b):
    """The given names have to be compatible, allowing for dropped middle names.

    Subsequence rather than one-to-one, because a feed routinely leaves middle
    names out: "Matt Short" has to stay compatible with "Matthew William Short".
    """
    return _contains(a, b)


def _spelled_ok(q_givens, c_givens):
    """Every given name the query spells out in full has a counterpart."""
    return all(any(_slot_ok((word, word[0]), c) for c in c_givens)
               for word, _ in q_givens if word)


def _name_score(q, c):
    """Similarity of two parsed names, weighted towards the surname."""
    score = max(fuzz.ratio(q['key'], c['key']),
                fuzz.token_sort_ratio(q['key'], c['key']),
                # token_set hits 100 whenever one name's words are a subset of
                # the other's, which is how every "... Singh" looks alike. Useful
                # as a signal, so keep it, but never as the outright winner.
                fuzz.token_set_ratio(q['key'], c['key']) - 6)
    if _surname_ok(q['surname'], c['surname']):
        score += 6
    elif fuzz.ratio(q['surname'], c['surname']) < 70:
        score -= 30          # different surname: almost certainly someone else
    return score


def team_abbr(team_id):
    """Feed team id -> our abbreviation, for use as a find_player() hint."""
    try:
        return (teamID.get(int(team_id)) or [None])[0]
    except (TypeError, ValueError):
        return None


def _shortlist(q, parsed, pool):
    """Cheap filter before the fuzzy pass, which is the expensive part.

    A name can only win the fuzzy pass if it shares a word with the query or its
    surname at least starts the same way - everything else is sitting 30 points
    down on the surname penalty. Falls back to the whole pool if that leaves
    nothing, so a badly mangled name still gets scored.
    """
    letter = q['surname'][:1]
    picked = [i for i in pool
              if q['tokens'] & parsed[i]['tokens'] or parsed[i]['surname'][:1] == letter]
    return picked or list(pool)


_SQUAD_INDEX = {}


def _squad_index(player_data):
    """Parse the squad once and reuse it; every page re-reads the same rows."""
    names = tuple(p[2] for p in player_data)
    teams = tuple(p[3] for p in player_data)
    cached = _SQUAD_INDEX.get((names, teams))
    if cached is not None:
        return cached

    parsed = [parse_name(n) for n in names]
    by_team = defaultdict(list)
    for i, t in enumerate(teams):
        if t:
            by_team[str(t).strip().upper()].append(i)

    index = {'rows': list(player_data), 'parsed': parsed, 'by_team': dict(by_team)}
    if len(_SQUAD_INDEX) > 3:        # the squad changes rarely; a tiny cache is plenty
        _SQUAD_INDEX.clear()
    _SQUAD_INDEX[(names, teams)] = index
    return index

def _match_in_pool(q, parsed, pool, threshold, margin):
    """Resolve a parsed name against a shortlist of squad rows. Returns an index."""
    # 1. The same name, written the same way.
    hits = [i for i in pool if parsed[i]['key'] == q['key']]
    if hits:
        return hits[0]

    # 2. The same words in a different order ("Kumar Nitish Reddy").
    hits = [i for i in pool if parsed[i]['sorted'] == q['sorted']]
    if hits:
        return hits[0]

    # 3. Structural: the surname has to match and the given names/initials have
    #    to be consistent with it. This is what carries "R Jadeja", "Natarajan",
    #    "Tilak Varma" and "Matt Short" - but only when it points at one player.
    hits = [i for i in pool
            if _surname_ok(q['surname'], parsed[i]['surname'])
            and _givens_ok(q['givens'], parsed[i]['givens'])]
    if len(hits) == 1:
        return hits[0]

    # 3a. Several share the surname, so let the shape of the name decide: a feed
    #     writing "M A Khan" is spelling out two given names, which rules out the
    #     Khans who only have one.
    if len(hits) > 1:
        same_shape = [i for i in hits
                      if len(parsed[i]['givens']) == len(q['givens'])]
        if len(same_shape) == 1:
            return same_shape[0]

    # 3b. One side carries an extra name on the *end*, so the two disagree about
    #     which word is even the surname: the feed's "Rasikh Dar Salam" against
    #     our "Rasikh Dar". Nothing above can see that, so drop the surname
    #     anchor and ask only that every word of the shorter name appears, in
    #     order, in the longer one. Two words minimum, so a bare "Singh" cannot
    #     reach this, and still only when it leaves one player standing.
    if not hits:
        contained = [i for i in pool
                     if min(len(q['slots']), len(parsed[i]['slots'])) >= 2
                     and _spells_out(q['slots'], parsed[i]['slots'])]
        if len(contained) == 1:
            return contained[0]

    # 3c. Feeds that initial a fuller name than ours carry initials for middle
    #     names the squad list does not have - "SA Yadav" against our "Surya
    #     Kumar Yadav". Relax to: surname matches, first initial matches, and
    #     every word the feed does spell out lines up. Still one player only.
    if not hits and q['givens']:
        loose = [i for i in pool
                 if _surname_ok(q['surname'], parsed[i]['surname'])
                 and parsed[i]['givens']
                 and q['givens'][0][1] == parsed[i]['givens'][0][1]
                 and _spelled_ok(q['givens'], parsed[i]['givens'])]
        if len(loose) == 1:
            return loose[0]

    # 3d. A lone word that is nobody's surname but is somebody's unique given
    #     name ("Rinku", "Sanju").
    if not hits and len(q['slots']) == 1 and q['slots'][0][0]:
        word = q['slots'][0][0]
        named = [i for i in pool
                 if any(w == word for w, _ in parsed[i]['givens'])]
        if len(named) == 1:
            return named[0]

    # 4. Fuzzy, over the structural shortlist when there is one. Commit only if
    #    the winner is a clear winner: two players scoring alike means the feed
    #    name genuinely does not say which, and a guess would be a wrong name,
    #    a wrong team crest and a wrong player page.
    candidates = hits if len(hits) > 1 else _shortlist(q, parsed, pool)
    scored = sorted(((_name_score(q, parsed[i]), i) for i in candidates),
                    key=lambda s: (-s[0], s[1]))
    if not scored:
        return None
    best, best_i = scored[0]
    if best < threshold:
        return None
    runner_up = scored[1][0] if len(scored) > 1 else 0
    if best - runner_up < margin:
        return None
    return best_i


def find_player(full_name, player_data, threshold=80, team=None, margin=8):
    """
    Find the player in the Squad table that a feed name refers to.

    Args:
        full_name (str): name as the feed spells it, e.g. "RA Jadeja", "Gill (c)"
        player_data (list): Squad rows; [2] is the name and [3] the team
        threshold (int): minimum similarity for the fuzzy fallback
        team (str): team abbreviation the feed puts the player in, if known.
            Searched first and only as a hint - a player we have on another
            team's list still matches on the second pass.
        margin (int): how far the fuzzy winner must beat the runner-up before
            the match is trusted

    Returns:
        tuple: the matching Squad row, or None if nothing matches unambiguously
    """
    if not full_name or not player_data:
        return None

    index = _squad_index(player_data)
    q = parse_name(full_name)
    if not q['key']:
        return None

    pools = []
    if team:
        in_team = index['by_team'].get(str(team).strip().upper())
        if in_team:
            pools.append(in_team)
    pools.append(range(len(index['rows'])))

    for pool in pools:
        hit = _match_in_pool(q, index['parsed'], pool, threshold, margin)
        if hit is not None:
            return index['rows'][hit]
    return None

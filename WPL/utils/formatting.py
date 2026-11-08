"""Shaping values for the templates and the JSON feeds."""
from datetime import datetime, date, time

def serialize(obj):
    if isinstance(obj, dict):
        return {k: serialize(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [serialize(i) for i in obj]
    elif isinstance(obj, (time, datetime, date)):
        return obj.isoformat()
    else:
        return obj

def _num(value, cast, default):
    try:
        return cast(value)
    except (TypeError, ValueError):
        return default

def super_overs(info):
    """The super overs stored on one side of a fixture, oldest first.

    A tied super over is replayed, so a match can have several. upMatchSuperOver()
    writes them as info['SO'], a list of {runs, wkts, overs} shaped like the main
    innings so the same markup can print either. Rows written before that carry a
    single super over flattened into runsSO/oversSO/wktsSO; those are read as a
    one-entry list rather than needing a migration.

    Values are coerced here, so a template can print them without guarding: a
    missing figure reads as zero, and a row that is 0/0 in 0 overs throughout is
    dropped as an empty block rather than shown as a super over nobody batted in.
    """
    if not isinstance(info, dict):
        return []
    rows = info.get('SO')
    if isinstance(rows, list):
        rows = [r for r in rows if isinstance(r, dict)]
    elif info.get('runsSO') is not None:
        rows = [{'runs': info.get('runsSO'), 'wkts': info.get('wktsSO'),
                 'overs': info.get('oversSO')}]
    else:
        return []
    rows = [{'runs': _num(r.get('runs'), int, 0),
             'wkts': _num(r.get('wkts'), int, 0),
             'overs': _num(r.get('overs'), float, 0.0)} for r in rows]
    return [r for r in rows if r['runs'] or r['wkts'] or r['overs']]

def num_suffix(num):
    if num % 100 in [11, 12, 13]:
        return str(num) + "th"
    elif (num % 10) == 1:
        return str(num) + "st"
    elif (num % 10) == 2:
        return str(num) + "nd"
    elif (num % 10) == 3:
        return str(num) + "rd"
    else:
        return str(num) + "th"

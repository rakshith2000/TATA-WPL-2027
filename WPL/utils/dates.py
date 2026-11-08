"""Dates and times.

Match times are IST whatever the host's clock says, so `tz` is the one source
of that; start_DT() also smooths over the date/time types the two database
drivers hand back.
"""
import pytz
from datetime import datetime, date, time

tz = pytz.timezone('Asia/Kolkata')

def calculate_age(dob, current_date):
    # Calculate the number of full years
    years = current_date.year - dob.year
    has_birthday_passed = (current_date.month, current_date.day) >= (dob.month, dob.day)

    # Adjust the years if the birthday has not yet occurred this year
    if not has_birthday_passed:
        years -= 1

    # Calculate the last birthday date
    last_birthday = dob.replace(year=current_date.year) if has_birthday_passed else dob.replace(
        year=current_date.year - 1)

    current_date = current_date.date()

    # Calculate the number of days since the last birthday
    days = (current_date - last_birthday).days
    return str(years) + " years " + str(days) + " days"

def concat_DT(D, T):
    dttm = D.strftime('%Y-%m-%d')+' '+ \
                     T.strftime('%H:%M:%S')
    return datetime.strptime(dttm, '%Y-%m-%d %H:%M:%S')

def start_DT(D, T):
    """A fixture's Date and Time as one datetime, whichever driver read them.

    Postgres hands back date/time objects; a raw text() SELECT against SQLite
    hands back the ISO strings it stored, microseconds and all. Both reach
    the templates through here so a page renders the same either way.
    """
    if not isinstance(D, date):
        D = datetime.strptime(str(D)[:10], '%Y-%m-%d').date()
    if not isinstance(T, time):
        S = str(T)
        T = datetime.strptime(S, '%H:%M:%S.%f' if '.' in S else '%H:%M:%S').time()
    return datetime.combine(D, T)

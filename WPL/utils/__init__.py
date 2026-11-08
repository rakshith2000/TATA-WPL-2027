"""Small, dependency-free helpers.

Nothing here touches the database, the feeds or the request - just arithmetic
and formatting, so these modules can be imported from anywhere without
dragging the rest of the app in behind them.

    overs       over arithmetic (x.y is balls out of six, not a fraction)
    dates       the IST timezone, ages, and date/time assembly
    formatting  JSON-safe values and ordinal numbers
"""

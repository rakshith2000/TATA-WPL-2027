"""The views, grouped by the part of the site they serve.

Each module registers its views on the `main` blueprint, which lives in
IPL/main.py and is imported from there. Importing a module is what registers
its routes, so main.py imports all five.

    pages   home, standings, fixtures, today's matches
    teams   franchise directory, one squad, one player
    stats   the leaderboard pages
    match   the match-centre shell
    admin   the login-protected update/delete views
"""

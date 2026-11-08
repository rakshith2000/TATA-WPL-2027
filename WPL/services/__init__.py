"""The work behind the views: the database, the feeds, and the maths.

Nothing in here imports a route or touches `request`, so each module can be
called from a view, from the scheduler, or from a background thread equally.

    playoffs            qualification model + Monte-Carlo simulation
    players             matching a feed's player name to the Squad table
    player_stats        one player's career record from the feed
    player_stats_stub   canned stand-in used while that feed is down
    feeds               the live-score URL, innings data, generic feed reads
    toppers             refreshing and reading the stats leaderboards
    pointstable         applying/reversing a result on the points table
    results             writing/clearing a result on its fixture
    standings           rank stamping, rank movement, next opponents
    live                the match-centre payloads the /api endpoints return
"""

"""The leaderboard pages."""
from flask import render_template

from ..main import main
from ..config import clr

#  The leaderboards themselves are fetched from /api/stats by static/js/stats.js;
#  the brand colours go out with the page so the crests in the table match the
#  ones everywhere else.

@main.route('/battingstats')
def battingstats():
    return render_template('battingStat.html', clr=clr)

@main.route('/bowlingstats')
def bowlingstats():
    return render_template('bowlingStat.html', clr=clr)

@main.route('/awards')
def awards():
    return render_template('awards.html', clr=clr)

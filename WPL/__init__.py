from flask import Flask
from flask_apscheduler import APScheduler
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from werkzeug.security import generate_password_hash, check_password_hash
import os, requests, uuid
from datetime import datetime, timedelta

# Same season reference data main.py reads, out of config.json
from .config import (SEASON_YEAR, teams_accent, teams_word, full_name, pofs,
                     PLAYOFF_SPOTS, LEAGUE_MATCHES, TEAMS)
from .utils.formatting import super_overs

db = SQLAlchemy()

def add_days(value, days):
    return value + timedelta(days=days)

def eval_str(value):
    return eval(value)

def render_live_URL(tA, tB, mn, dt):
    """Templates link straight at the sportskeeda page; the builder is in
    services.feeds, which this re-exports as a Jinja filter."""
    from .services.feeds import render_live_URL as build
    return build(tA, tB, mn, dt)

def create_app():
    app = Flask(__name__)

    # Set config from environment variables or defaults
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'secret-key')
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///WPL.sqlite')

    app.jinja_env.filters['add_days'] = add_days
    app.jinja_env.filters['eval_str'] = eval_str
    app.jinja_env.filters['render_live_URL'] = render_live_URL

    # Three templates print a fixture's super overs; they all read the stored
    # A_info/B_info through this rather than reaching for the keys themselves.
    app.jinja_env.globals['super_overs'] = super_overs
    # Every page prints the season somewhere, so it goes out with all of them,
    # along with the season's shape and the per-team accent/identity word the
    # macros in macros/points.html read.
    app.jinja_env.globals['SEASON'] = SEASON_YEAR
    app.jinja_env.globals['SPOTS'] = PLAYOFF_SPOTS
    app.jinja_env.globals['LEAGUE_MATCHES'] = LEAGUE_MATCHES
    app.jinja_env.globals['TEAM_ACCENT'] = teams_accent
    app.jinja_env.globals['TEAM_WORD'] = teams_word
    # The admin pages list the teams and the playoff ties without a route
    # passing them in, so they come from here too.
    app.jinja_env.globals['TEAM_LIST'] = [(t, full_name[t]) for t in TEAMS]
    app.jinja_env.globals['POFS'] = pofs

    db.init_app(app)
    login_manager = LoginManager()
    login_manager.login_view = 'auth.login'
    login_manager.init_app(app)

    from .models import User
    #
    @login_manager.user_loader
    def load_user(user_id):
        # The session stores the id as a string. Postgres takes that for a UUID
        # column happily; SQLite's UUID type wants a real uuid.UUID and raises
        # on a string, which logs the admin straight back out again. Cast here
        # so the app behaves the same on either database, and treat anything
        # unparseable as "no such user" rather than an error.
        try:
            return User.query.get(uuid.UUID(str(user_id)))
        except (ValueError, AttributeError, TypeError):
            return None

    from .main import main as main_blueprint
    app.register_blueprint(main_blueprint)

    from .auth import auth as auth_blueprint
    app.register_blueprint(auth_blueprint)

    from .api import api as api_blueprint
    app.register_blueprint(api_blueprint)

    from . import models
    from .main import refresh_qualification, update_toppers

    scheduler = APScheduler()
    scheduler.init_app(app)
    scheduler.start()

    @scheduler.task('interval', id='ping_task', seconds=600, misfire_grace_time=120)
    def ping():
        try:
            # Replace with your app's URL
            response = requests.get('https://tata-wpl-2027.onrender.com/login')
            print(f"Ping successful, status code: {response.status_code}")
        except Exception as e:
            print(f"Error pinging app: {e}")

    from .seed import seed_all, seed_all_locked

    @app.cli.command('seed')
    def seed_command():
        """Load reference data into the tables."""
        seed_all()

    with app.app_context():
        db.create_all()
        if os.environ.get('SEED_ON_STARTUP', '1') == '1':
            try:
                seed_all_locked()
            except Exception:
                app.logger.exception('seeding failed')   # never block boot

    @scheduler.task('interval', id='qualification_task', hours=1, misfire_grace_time=120)
    def update_qualification():
        with app.app_context():
            try:
                refresh_qualification()
                print("Qualification percentages updated.")
            except Exception as e:
                print(f"Error updating qualifications: {e}")

    @scheduler.task('interval', id='update_toppers_task', minutes=10, misfire_grace_time=120)
    def update_toppers_task():
        with app.app_context():
            try:
                update_toppers()
                print("Top players updated.")
            except Exception as e:
                print(f"Error updating toppers: {e}")

    return app

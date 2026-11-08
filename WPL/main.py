"""The `main` blueprint, and the wiring that puts the site together.

This module used to hold everything - the views, the feeds, the simulation and
the helpers, in one file. It now owns only the blueprint; the rest sits in
three packages beside it:

    routes/     one module per group of views, registered on `main`
    services/   the work the views call: database, feeds, maths
    utils/      small helpers with no dependencies of their own

Season data - team names, colours, feed URLs, the shape of the playoffs - is in
config.json.

The blueprint is created here, before the route modules are imported, because
importing them is what registers their views on it. It also stays here so the
blueprint's root path is WPL/, where the templates and static files are.
"""
import warnings
import cloudscraper
from flask import Blueprint

warnings.filterwarnings("ignore")

# Kept from when the feeds were scraped rather than read as JSON; nothing
# calls it today, but creating it is cheap and the feeds do change.
scraper = cloudscraper.create_scraper()

main = Blueprint('main', __name__)

# Importing each route module registers its views on `main`. These have to come
# after the blueprint exists, which is why they are not at the top of the file.
from .routes import pages, teams, stats, match, admin   # noqa: E402,F401

# Re-exported for create_app(), which runs both as scheduled background jobs.
from .services.playoffs import refresh_qualification    # noqa: E402,F401
from .services.toppers import update_toppers            # noqa: E402,F401

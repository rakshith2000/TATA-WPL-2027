"""Scheduled, source-checked team research for the season predictor."""
import json
import math
import os
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

import requests

from .. import db
from ..config import SEASON_YEAR, TEAMS, full_name
from ..models import Squad, TeamIntelligence

MAX_REPORT_AGE_DAYS = 30
ACTIVE_SNAPSHOT_AGE = timedelta(hours=36)
MAX_RUN_ADJUSTMENT = 6.0
REQUEST_TIMEOUT = 120
REPORT_TOPICS = (
    "injury", "availability", "player_form", "team_form", "team_result", "squad",
)


def _utcnow_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _response_value(value, name, default=None):
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)


def _output_text(response):
    parts = []
    for item in _response_value(response, "output", []) or []:
        if _response_value(item, "type") != "message":
            continue
        for content in _response_value(item, "content", []) or []:
            if _response_value(content, "type") == "output_text":
                text = _response_value(content, "text")
                if isinstance(text, str):
                    parts.append(text)
    return "\n".join(parts)


def _grounded_citations(response):
    citations = {}
    for item in _response_value(response, "output", []) or []:
        for content in _response_value(item, "content", []) or []:
            for annotation in _response_value(content, "annotations", []) or []:
                if _response_value(annotation, "type") != "url_citation":
                    continue
                url = _response_value(annotation, "url")
                if isinstance(url, str):
                    citations[url] = _response_value(annotation, "title", "")
    return citations


def _has_web_search(response):
    return any(_response_value(item, "type") == "web_search_call"
               for item in _response_value(response, "output", []) or [])


def _request_responses(payload):
    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
    api_key = os.environ.get("AZURE_OPENAI_API_KEY")
    deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT")
    if not endpoint or not api_key or not deployment:
        raise RuntimeError(
            "Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and "
            "AZURE_OPENAI_DEPLOYMENT to enable team research."
        )

    if not endpoint.endswith("/openai/v1"):
        endpoint += "/openai/v1"
    response = requests.post(
        endpoint + "/responses",
        headers={"api-key": api_key, "Content-Type": "application/json"},
        json=dict(payload, model=deployment),
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    result = response.json()
    if not isinstance(result, dict):
        raise RuntimeError("Azure OpenAI returned an invalid Responses API payload.")
    return result


def _schema():
    report = {
        "type": "object",
        "properties": {
            "player": {"type": "string"},
            "topic": {"type": "string", "enum": list(REPORT_TOPICS)},
            "availability": {
                "type": "string",
                "enum": ["available", "doubtful", "unavailable", "unknown", "not_applicable"],
            },
            "published_at": {"type": "string"},
            "source": {"type": "string"},
            "evidence": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": [
            "player", "topic", "availability", "published_at", "source",
            "evidence", "confidence",
        ],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "teams": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "team": {"type": "string", "enum": TEAMS},
                        "summary": {"type": "string"},
                        "batting_adjustment_runs": {"type": "number"},
                        "bowling_adjustment_runs": {"type": "number"},
                        "factor_confidence": {"type": "number"},
                        "factor_evidence": {"type": "string"},
                        "factor_sources": {"type": "array", "items": {"type": "string"}},
                        "reports": {
                            "type": "array",
                            "items": report,
                        },
                    },
                    "required": [
                        "team", "summary", "batting_adjustment_runs",
                        "bowling_adjustment_runs", "factor_confidence",
                        "factor_evidence", "factor_sources", "reports",
                    ],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["teams"],
        "additionalProperties": False,
    }


def _parse_published_date(value):
    if not isinstance(value, str):
        return None
    try:
        if len(value) == 10:
            return date.fromisoformat(value)
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.utcoffset() is None:
            return None
        return timestamp.date()
    except ValueError:
        return None


def _safe_score(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or not -MAX_RUN_ADJUSTMENT <= value <= MAX_RUN_ADJUSTMENT:
        return None
    return float(value)


def _safe_confidence(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or not 0 <= value <= 1:
        return None
    return float(value)


def _latest_rows():
    ranked = (db.session.query(
        TeamIntelligence.id,
        db.func.row_number().over(
            partition_by=TeamIntelligence.team_name,
            order_by=(TeamIntelligence.refreshed_at.desc(), TeamIntelligence.id.desc()),
        ).label("position"),
    ).filter(TeamIntelligence.season == str(SEASON_YEAR)).subquery())
    return (TeamIntelligence.query
            .join(ranked, TeamIntelligence.id == ranked.c.id)
            .filter(ranked.c.position == 1)
            .all())


def _validated_team_data(team_data, grounded_citations, today=None):
    """Keep only recent, dated HTTPS sources returned as search citations."""
    today = today or datetime.now(timezone.utc).date()
    valid_reports = []
    all_reports_valid = True
    for report in team_data["reports"]:
        if not isinstance(report, dict):
            all_reports_valid = False
            continue
        source = report.get("source")
        parsed = urlparse(source) if isinstance(source, str) else None
        published = _parse_published_date(report.get("published_at"))
        confidence = _safe_confidence(report.get("confidence"))
        evidence = report.get("evidence")
        player = report.get("player")
        if (not isinstance(player, str)
                or not parsed or parsed.scheme != "https" or not parsed.netloc
                or source not in grounded_citations
                or report.get("topic") not in REPORT_TOPICS
                or report.get("availability") not in {
                    "available", "doubtful", "unavailable", "unknown", "not_applicable",
                }
                or not published
                or (today - published).days < 0
                or (today - published).days > MAX_REPORT_AGE_DAYS
                or confidence is None
                or not isinstance(evidence, str) or not evidence.strip()):
            all_reports_valid = False
            continue
        valid_reports.append({
            "player": player.strip()[:120],
            "topic": report["topic"],
            "availability": report["availability"],
            "published_at": report["published_at"],
            "source": source,
            "source_title": grounded_citations[source],
            "evidence": evidence.strip()[:600],
            "confidence": confidence,
        })

    source_urls = set(grounded_citations)
    factor_sources = team_data["factor_sources"]
    factor_sources_valid = (
        isinstance(factor_sources, list)
        and bool(factor_sources)
        and all(isinstance(source, str) for source in factor_sources)
    )
    factor_report_sources = {
        report["source"] for report in valid_reports
        if report["topic"] != "team_result"
    }
    factors_grounded = (
        factor_sources_valid
        and set(factor_sources).issubset(source_urls)
        and set(factor_sources).issubset(factor_report_sources)
    )
    factor_confidence = _safe_confidence(team_data["factor_confidence"])
    batting = _safe_score(team_data["batting_adjustment_runs"])
    bowling = _safe_score(team_data["bowling_adjustment_runs"])
    factor_evidence = team_data["factor_evidence"]

    # A malformed, stale, or uncited report may have influenced the aggregate
    # rating. In that case preserve any individually valid reports for display,
    # but do not use the aggregate score in the prediction model.
    apply_factors = (
        bool(valid_reports) and all_reports_valid and factors_grounded
        and factor_confidence is not None and batting is not None and bowling is not None
        and isinstance(factor_evidence, str) and factor_evidence.strip()
    )
    if apply_factors:
        factor_confidence = min(
            factor_confidence,
            sum(report["confidence"] for report in valid_reports) / len(valid_reports),
        )
    else:
        factor_confidence, batting, bowling = 0.0, 0.0, 0.0

    return {
        "schema_version": 1,
        "summary": (str(team_data["summary"]).strip()[:500]
                    if valid_reports else "No recent, dated source-backed updates found."),
        "batting_adjustment_runs": batting,
        "bowling_adjustment_runs": bowling,
        "factor_confidence": factor_confidence,
        "factor_evidence": (
            str(factor_evidence).strip()[:600] if apply_factors else ""
        ),
        "factor_sources": factor_sources if apply_factors else [],
        "reports": valid_reports,
    }


def _extract_teams(search_response, citations):
    grounded_text = _output_text(search_response)
    sources = [{"url": url, "title": title} for url, title in citations.items()]
    schema = _schema()
    prompt = (
        "Extract source-grounded cricket research for every WPL team from the "
        "search results below. Return exactly one entry for each requested team, "
        "using its team code. Do not invent facts, players, dates, sources, or "
        "statistics. Include only reports with an explicit publication date "
        "within the last 30 days and a source URL from the supplied citation list. "
        "If a team has no qualifying information, return empty reports and zero "
        "adjustments. Ignore rumors and auction/retention chatter unless it "
        "confirms player availability or roster status. For adjustments, estimate "
        "the short-term effect on projected runs per innings relative to this "
        "predictor's existing season fit, based only on player form, confirmed "
        "availability, or roster changes; do not re-score current-season match "
        "results already used by the engine. Positive batting means more runs "
        "scored; positive bowling means more runs conceded. Keep each adjustment "
        "within -6 to +6 runs and use zero when evidence is insufficient. Every "
        "nonzero adjustment needs factor_sources drawn from the valid report "
        "sources and a concise factor_evidence explanation. Report confidence "
        "between 0 and 1. Return no more than six high-quality reports per team. "
        "Dates must be YYYY-MM-DD or ISO-8601.\n\n"
        "Teams: " + json.dumps({team: full_name.get(team, team) for team in TEAMS})
        + "\n\nSearch result text:\n" + grounded_text
        + "\n\nGrounded citations:\n" + json.dumps(sources, ensure_ascii=True)
    )
    response = _request_responses({
        "input": prompt,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "wpl_team_research",
                "strict": True,
                "schema": schema,
            }
        },
        "max_output_tokens": 7000,
    })
    text = _output_text(response)
    try:
        result = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Azure OpenAI returned invalid structured team research.") from exc
    teams = result.get("teams") if isinstance(result, dict) else None
    if not isinstance(teams, list) or len(teams) != len(TEAMS):
        raise RuntimeError("Team research must contain exactly one entry per WPL team.")
    by_team = {}
    for team_data in teams:
        if not isinstance(team_data, dict) or team_data.get("team") not in TEAMS:
            raise RuntimeError("Team research contains an unknown or malformed team.")
        team = team_data["team"]
        if (team in by_team or not isinstance(team_data.get("reports"), list)
                or len(team_data["reports"]) > 12):
            raise RuntimeError("Team research contains duplicate teams or invalid reports.")
        by_team[team] = _validated_team_data(team_data, citations)
    if set(by_team) != set(TEAMS):
        raise RuntimeError("Team research did not cover all configured WPL teams.")
    return by_team


def refresh_team_intelligence():
    """Fetch and atomically persist one research snapshot for every WPL team."""
    today = datetime.now(timezone.utc).date()
    earliest = today - timedelta(days=MAX_REPORT_AGE_DAYS)
    team_names = ", ".join(
        f"{full_name.get(team, team)} ({team})" for team in TEAMS
    )
    rosters = {team: [] for team in TEAMS}
    for player in Squad.query.filter(Squad.Team.in_(TEAMS)).order_by(Squad.Team, Squad.Name):
        rosters[player.Team].append({
            "player": player.Name,
            "role": player.Role or "",
        })
    search_prompt = (
        f"Today is {today.isoformat()} UTC. Research the WPL {SEASON_YEAR} teams: "
        f"{team_names}. Search separately for each team and its key players. Find "
        "reputable official or established-news reports published from "
        f"{earliest.isoformat()} through {today.isoformat()} about confirmed "
        "injuries, fitness, return-to-play, likely availability/lineups, recent "
        "individual player form, roster changes, and recent team results. Prefer "
        "primary sources and dated reporting. Do not infer availability from "
        "squad membership, copy undated pages as news, or treat rumors as facts. "
        "Summarize with citations and explicit publication dates; clearly say "
        "when a team has no matching reports.\n\n"
        "Current roster names and roles from the app database (use for player "
        "searches, not as evidence of availability):\n"
        + json.dumps(rosters, ensure_ascii=True)
    )
    search_response = _request_responses({
        "input": search_prompt,
        "tools": [{"type": "web_search"}],
        "max_output_tokens": 5000,
    })
    if not _has_web_search(search_response):
        raise RuntimeError("Azure OpenAI did not execute the required web search.")
    citations = _grounded_citations(search_response)
    if not citations:
        raise RuntimeError("Web search returned no grounded source citations.")
    team_data = _extract_teams(search_response, citations)
    refreshed_at = _utcnow_naive()

    try:
        for team in TEAMS:
            db.session.add(TeamIntelligence(
                season=str(SEASON_YEAR),
                team_name=team,
                refreshed_at=refreshed_at,
                data=team_data[team],
            ))
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return {"teams": len(team_data), "refreshed_at": refreshed_at.isoformat() + "Z"}


def current_team_signals(now=None):
    """Return fresh, confidence-weighted adjustments; stale data is ignored."""
    now = now or _utcnow_naive()
    signals = {}
    for row in _latest_rows():
        team = row.team_name
        age = now - row.refreshed_at
        if age < timedelta(0) or age > ACTIVE_SNAPSHOT_AGE:
            continue
        data = row.data if isinstance(row.data, dict) else {}
        if data.get("schema_version") != 1:
            continue
        confidence = _safe_confidence(data.get("factor_confidence")) or 0.0
        if age <= timedelta(hours=24):
            freshness = 1.0
        else:
            freshness = max(
                0.0,
                (ACTIVE_SNAPSHOT_AGE - age).total_seconds() / timedelta(hours=12).total_seconds(),
            )
        sources = data.get("factor_sources") or []
        if not sources or not data.get("reports"):
            continue
        batting = _safe_score(data.get("batting_adjustment_runs"))
        bowling = _safe_score(data.get("bowling_adjustment_runs"))
        if batting is None or bowling is None:
            continue
        weight = confidence * freshness
        signals[team] = {
            "batting": batting * weight,
            "bowling": bowling * weight,
            "confidence": confidence,
            "freshness": freshness,
        }
    return signals


def latest_team_research(now=None):
    """A UI-safe research summary, including stale data marked as inactive."""
    now = now or _utcnow_naive()
    latest = {row.team_name: row for row in _latest_rows()}

    active_signals = current_team_signals(now)
    teams = {}
    timestamps = []
    for team in TEAMS:
        row = latest.get(team)
        if row is None:
            teams[team] = {"active": False, "fresh": False, "reports": []}
            continue
        timestamps.append(row.refreshed_at)
        data = row.data if isinstance(row.data, dict) else {}
        age = now - row.refreshed_at
        teams[team] = {
            "active": team in active_signals,
            "fresh": timedelta(0) <= age <= ACTIVE_SNAPSHOT_AGE,
            "summary": str(data.get("summary") or ""),
            "batting_adjustment_runs": round(
                active_signals.get(team, {}).get("batting", 0.0), 2
            ),
            "bowling_adjustment_runs": round(
                active_signals.get(team, {}).get("bowling", 0.0), 2
            ),
            "refreshed_at": row.refreshed_at.isoformat() + "Z",
            "reports": data.get("reports") if isinstance(data.get("reports"), list) else [],
        }
    latest_at = max(timestamps) if timestamps else None
    return {
        "active": len(active_signals) > 0,
        "all_teams_refreshed": all(team in latest for team in TEAMS),
        "refreshed_at": latest_at.isoformat() + "Z" if latest_at else None,
        "teams": teams,
    }

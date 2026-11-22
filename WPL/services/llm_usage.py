"""Persistence and dashboard aggregation for LLM token usage."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from flask import current_app

from .. import db
from ..models import LLMUsage

MODEL_NAME = "GPT-5.1"
INPUT_COST_PER_MILLION = Decimal("1.25")
CACHE_COST_PER_MILLION = Decimal("0.125")
OUTPUT_COST_PER_MILLION = Decimal("10")
_MILLION = Decimal("1000000")
_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90}


def _token_count(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("Token counts must be non-negative integers.")
    return value


def _usage_counts(response):
    usage = response.get("usage")
    if not isinstance(usage, dict):
        raise ValueError("The LLM response has no usage metadata.")

    input_total = _token_count(usage.get("input_tokens"))
    cached = _token_count(
        (usage.get("input_tokens_details") or {}).get("cached_tokens", 0)
    )
    output = _token_count(usage.get("output_tokens"))
    if cached > input_total:
        raise ValueError("Cached tokens exceed the reported input token count.")
    return input_total, cached, output


def _cost_usd(input_tokens, cached_tokens, output_tokens):
    return (
        Decimal(input_tokens) * INPUT_COST_PER_MILLION
        + Decimal(cached_tokens) * CACHE_COST_PER_MILLION
        + Decimal(output_tokens) * OUTPUT_COST_PER_MILLION
    ) / _MILLION


def record_llm_usage(response, operation):
    """Persist usage after each API response without storing the prompt itself."""
    try:
        input_tokens, cached_tokens, output_tokens = _usage_counts(response)
        usage_available = True
    except (AttributeError, TypeError, ValueError):
        current_app.logger.exception(
            "LLM response usage metadata is missing or invalid (%s).", operation
        )
        input_tokens = cached_tokens = output_tokens = 0
        usage_available = False

    row = LLMUsage(
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        model=MODEL_NAME,
        operation=operation,
        input_tokens=input_tokens,
        cached_tokens=cached_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cost_usd=_cost_usd(input_tokens - cached_tokens, cached_tokens, output_tokens),
        usage_available=usage_available,
    )
    db.session.add(row)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to persist LLM usage (%s).", operation)
        raise


def _decimal_sum(rows, attribute):
    return sum(
        (Decimal(str(getattr(row, attribute) or 0)) for row in rows),
        Decimal("0"),
    )


def dashboard_data(period):
    """Build aggregates and daily chart series for the requested date range."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    query = LLMUsage.query
    if period in _PERIOD_DAYS:
        query = query.filter(
            LLMUsage.created_at >= now - timedelta(days=_PERIOD_DAYS[period])
        )
    rows = query.order_by(LLMUsage.created_at.desc()).all()
    tracked = [row for row in rows if row.usage_available]

    if period in _PERIOD_DAYS:
        first_day = (now - timedelta(days=_PERIOD_DAYS[period])).date()
    elif rows:
        first_day = min(row.created_at.date() for row in rows)
    else:
        first_day = (now - timedelta(days=29)).date()
    days = [
        first_day + timedelta(days=offset)
        for offset in range((now.date() - first_day).days + 1)
    ]
    daily = {
        day.isoformat(): {
            "input": 0, "cached": 0, "output": 0, "total": 0,
            "input_cost": 0.0, "cache_cost": 0.0, "output_cost": 0.0,
        }
        for day in days
    }
    for row in tracked:
        point = daily.get(row.created_at.date().isoformat())
        if point is None:
            continue
        point["input"] += row.input_tokens - row.cached_tokens
        point["cached"] += row.cached_tokens
        point["output"] += row.output_tokens
        point["total"] += row.total_tokens
        point["input_cost"] += float(
            Decimal(row.input_tokens - row.cached_tokens)
            * INPUT_COST_PER_MILLION / _MILLION
        )
        point["cache_cost"] += float(
            Decimal(row.cached_tokens) * CACHE_COST_PER_MILLION / _MILLION
        )
        point["output_cost"] += float(
            Decimal(row.output_tokens) * OUTPUT_COST_PER_MILLION / _MILLION
        )

    input_cost = (
        Decimal(sum(row.input_tokens - row.cached_tokens for row in tracked))
        * INPUT_COST_PER_MILLION / _MILLION
    )
    cache_cost = (
        Decimal(sum(row.cached_tokens for row in tracked))
        * CACHE_COST_PER_MILLION / _MILLION
    )
    output_cost = (
        Decimal(sum(row.output_tokens for row in tracked))
        * OUTPUT_COST_PER_MILLION / _MILLION
    )
    total_cost = _decimal_sum(tracked, "cost_usd")
    token_totals = {
        "input": sum(row.input_tokens - row.cached_tokens for row in tracked),
        "cached": sum(row.cached_tokens for row in tracked),
        "output": sum(row.output_tokens for row in tracked),
    }

    return {
        "period": period,
        "periods": ("7d", "30d", "90d", "all"),
        "model": MODEL_NAME,
        "calls": len(rows),
        "tracked_calls": len(tracked),
        "untracked_calls": len(rows) - len(tracked),
        "total_tokens": sum(row.total_tokens for row in tracked),
        "total_cost": float(total_cost),
        "average_cost": float(total_cost / len(tracked)) if tracked else 0,
        "token_totals": token_totals,
        "cost_breakdown": {
            "input": float(input_cost),
            "cached": float(cache_cost),
            "output": float(output_cost),
        },
        "daily": [
            {"date": day.isoformat(), **daily[day.isoformat()]}
            for day in days
        ],
        "recent_calls": [
            {
                "created_at": row.created_at.isoformat(timespec="seconds") + "Z",
                "model": row.model,
                "operation": row.operation,
                "input_tokens": row.input_tokens,
                "cached_tokens": row.cached_tokens,
                "output_tokens": row.output_tokens,
                "total_tokens": row.total_tokens,
                "cost_usd": float(row.cost_usd or 0),
                "usage_available": row.usage_available,
            }
            for row in rows[:20]
        ],
    }

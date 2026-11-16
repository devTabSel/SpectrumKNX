"""API tests for the telegram import/export endpoints (see DESIGN_IMPORT_EXPORT.md)."""

import csv
import io
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from knx_telegram_store import StoredTelegram, TelegramQueryResult

import telegram_import
from main import app

client = TestClient(app)


def _reset_job():
    telegram_import.current_job = None


# ── /api/import/status ───────────────────────────────────────────────────────


def test_import_status_idle():
    _reset_job()
    response = client.get("/api/import/status")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "idle"
    assert "read_only" in body


def test_import_status_reports_running_job():
    telegram_import.current_job = telegram_import.ImportJob(filename="log.xml")
    try:
        body = client.get("/api/import/status").json()
        assert body["state"] == "running"
        assert body["filename"] == "log.xml"
    finally:
        _reset_job()


# ── /api/import (upload) ─────────────────────────────────────────────────────


def test_import_rejects_bad_extension():
    _reset_job()
    response = client.post("/api/import", files={"file": ("log.txt", b"nope", "text/plain")})
    assert response.status_code == 400


@patch("api.READ_ONLY", True)
def test_import_forbidden_in_read_only():
    response = client.post("/api/import", files={"file": ("log.xml", b"<x/>", "application/xml")})
    assert response.status_code == 403


@patch("api.telegram_import.start_import")
def test_import_starts_job(mock_start):
    _reset_job()
    mock_start.return_value = telegram_import.ImportJob(filename="log.xml")
    response = client.post("/api/import", files={"file": ("log.xml", b"<CommunicationLog/>", "application/xml")})
    assert response.status_code == 200
    assert response.json()["state"] == "running"
    assert mock_start.called
    # The upload was spooled to a real temp path that is handed to the importer.
    assert mock_start.call_args[0][1].endswith(".xml")


@patch("api.telegram_import.start_import", side_effect=RuntimeError("An import is already running"))
def test_import_conflict_when_running(mock_start):
    _reset_job()
    response = client.post("/api/import", files={"file": ("log.xml", b"<CommunicationLog/>", "application/xml")})
    assert response.status_code == 409


# ── /api/import/cancel ───────────────────────────────────────────────────────


def test_cancel_when_none_running():
    _reset_job()
    assert client.post("/api/import/cancel").status_code == 404


def test_cancel_running_job():
    telegram_import.current_job = telegram_import.ImportJob(filename="log.xml")
    try:
        assert client.post("/api/import/cancel").status_code == 200
        assert telegram_import.current_job.cancel_requested is True
    finally:
        _reset_job()


# ── /api/export ──────────────────────────────────────────────────────────────


@patch("database.store.query", new_callable=AsyncMock)
def test_export_streams_communication_log(mock_query):
    mock_query.return_value = TelegramQueryResult(
        telegrams=[
            StoredTelegram(
                timestamp=datetime(2026, 3, 5, 0, 0, 0, tzinfo=UTC),
                source="1.0.18",
                destination="2/4/61",
                telegramtype="GroupValueWrite",
                direction="Incoming",
                dpt_main=5,
                dpt_sub=1,
                payload=None,
                value=200.0,
                raw_data="00c8",
            )
        ],
        total_count=1,
        limit_reached=False,
    )

    response = client.get("/api/export?start_time=2026-03-05T00:00:00Z")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/xml")
    assert "attachment" in response.headers["content-disposition"]
    body = response.text
    assert "<CommunicationLog" in body and "</CommunicationLog>" in body
    assert "L_Data.ind" in body
    # Re-parse the exported XML to confirm it round-trips through the library reader.
    from knx_telegram_store.formats import iter_communication_log

    records = list(iter_communication_log(io.BytesIO(body.encode())))
    assert len(records) == 1
    assert records[0].service == "L_Data.ind"


@patch("database.store.query", new_callable=AsyncMock)
def test_export_empty_still_valid_xml(mock_query):
    mock_query.return_value = TelegramQueryResult(telegrams=[], total_count=0, limit_reached=False)
    body = client.get("/api/export").text
    assert body.startswith("<?xml")
    assert "<CommunicationLog" in body and "</CommunicationLog>" in body


@patch("database.store.query", new_callable=AsyncMock)
def test_export_csv(mock_query):
    mock_query.return_value = TelegramQueryResult(
        telegrams=[
            StoredTelegram(
                timestamp=datetime(2026, 3, 5, 0, 0, 0, tzinfo=UTC),
                source="1.0.18",
                destination="2/4/61",
                telegramtype="GroupValueWrite",
                direction="Incoming",
                dpt_main=5,
                dpt_sub=1,
                payload=None,
                value=200.0,
                raw_data="00c8",
                source_name="Aktor; Küche",
                destination_name="Dimmwert",
            )
        ],
        total_count=1,
        limit_reached=False,
    )

    response = client.get("/api/export?format=csv&delimiter=semicolon")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert ".csv" in response.headers["content-disposition"]
    lines = response.content.decode("utf-8-sig").splitlines()
    assert lines[0] == (
        "timestamp;source;source_name;target;target_name;type;direction;dpt;dpt_name;value;value_numeric;unit;raw"
    )
    row = lines[1].split(";")
    assert row[0] == "2026-03-05T00:00:00+00:00"
    assert row[1] == "1.0.18"
    # a delimiter inside a name is quoted
    assert '"Aktor; Küche"' in lines[1]
    assert "2/4/61" in lines[1] and "5.001" in lines[1] and "0x00c8" in lines[1]
    assert len(lines) == 2


@patch("database.store.query", new_callable=AsyncMock)
def test_export_rejects_unknown_format(mock_query):
    assert client.get("/api/export?format=json").status_code == 400
    assert client.get("/api/export?format=csv&delimiter=tab").status_code == 400


def _export_row(ts: datetime, n: int) -> StoredTelegram:
    return StoredTelegram(
        timestamp=ts,
        source="1.1.1",
        destination="1/1/1",
        telegramtype="GroupValueWrite",
        direction="Incoming",
        dpt_main=5,
        dpt_sub=1,
        payload=None,
        value=float(n),
        raw_data=f"{n:04x}",
    )


def _query_side_effect(rows: list[StoredTelegram]):
    seen: list = []

    async def fake_query(query, flush_first=True):
        seen.append(query)
        matched = [
            row
            for row in rows
            if (query.start_time is None or row.timestamp >= query.start_time)
            and (query.end_time is None or row.timestamp <= query.end_time)
        ]
        matched.sort(key=lambda row: row.timestamp, reverse=query.order_descending)
        total = len(matched)
        page = matched[query.offset : query.offset + query.limit]
        return TelegramQueryResult(
            telegrams=page,
            total_count=total,
            limit_reached=total > query.offset + query.limit,
        )

    return fake_query, seen


def _csv_raws(response) -> list[str]:
    text = response.content.decode("utf-8-sig")
    table = list(csv.reader(io.StringIO(text)))
    assert table[0][-1] == "raw"
    return [row[-1] for row in table[1:]]


@patch("api.EXPORT_PAGE_SIZE", 2)
@patch("database.store.query", new_callable=AsyncMock)
def test_export_pages_distinct_timestamps_once(mock_query):
    base = datetime(2026, 3, 5, tzinfo=UTC)
    rows = [_export_row(base + timedelta(milliseconds=i), i) for i in range(5)]
    fake_query, seen = _query_side_effect(rows)
    mock_query.side_effect = fake_query

    raws = _csv_raws(client.get("/api/export?format=csv&limit=100"))
    assert raws == [f"0x{i:04x}" for i in range(5)]
    assert all(query.offset == 0 and query.order_descending is False for query in seen)
    # Distinct timestamps never collapse into an exact-timestamp re-query.
    # An omitted bound is None, and None == None, so compare only set bounds.
    assert all(query.start_time is None or query.start_time != query.end_time for query in seen)


@patch("api.EXPORT_PAGE_SIZE", 3)
@patch("database.store.query", new_callable=AsyncMock)
def test_export_same_timestamp_across_pages_once(mock_query):
    """A timestamp wider than a page, including one that splits a page boundary, is exported once."""
    base = datetime(2026, 3, 5, tzinfo=UTC)
    t0 = base
    t1 = base + timedelta(milliseconds=5)
    t2 = base + timedelta(milliseconds=10)
    rows = (
        [_export_row(t0, n) for n in range(2)]
        + [_export_row(t1, n) for n in range(2, 7)]
        + [_export_row(t2, n) for n in range(7, 9)]
    )
    fake_query, seen = _query_side_effect(rows)
    mock_query.side_effect = fake_query

    raws = _csv_raws(client.get("/api/export?format=csv&limit=100"))
    assert raws == [f"0x{i:04x}" for i in range(9)]
    assert len(raws) == len(set(raws))
    assert all(query.offset == 0 and query.order_descending is False for query in seen)
    exact = [query for query in seen if query.start_time == t1 and query.end_time == t1]
    assert exact
    assert any(query.limit == 5 for query in exact)

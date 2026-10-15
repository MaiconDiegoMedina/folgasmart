# FolgaSmart API regression tests: employees CRUD, movement CSV import, peaks, schedule generate/toggle
import os
import pytest
import requests
from pathlib import Path


def _base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                url = line.split("=", 1)[1].strip()
    return url.rstrip("/")


BASE_URL = _base_url()
API = f"{BASE_URL}/api"

# Week starting Monday 2026-04-06; values make Fri/Sat/Sun peaks
WEEK_VALUES = [120, 95, 100, 130, 210, 260, 180]


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    return sess


@pytest.fixture(scope="session", autouse=True)
def preserve_state(s):
    """Snapshot movement/schedule and restore after the session (re-imports same weekday averages)."""
    mov = s.get(f"{API}/movement").json()
    sched = s.get(f"{API}/schedule").json()
    yield
    # cleanup TEST_ employees
    for e in s.get(f"{API}/employees").json():
        if e["name"].startswith("TEST_"):
            s.delete(f"{API}/employees/{e['id']}")
    # restore movement via direct mongo (exact copy)
    try:
        from pymongo import MongoClient
        env = dict(l.split("=", 1) for l in Path("/app/backend/.env").read_text().splitlines() if "=" in l)
        c = MongoClient(env["MONGO_URL"].strip('"'))
        db = c[env["DB_NAME"].strip('"')]
        db.movement.replace_one({"_key": "main"}, {"_key": "main", **mov}, upsert=True)
        db.schedule.replace_one({"_key": "main"}, {"_key": "main", **sched}, upsert=True)
    except Exception as ex:  # pragma: no cover
        print("restore failed", ex)


# --- Health
def test_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200
    assert r.json()["message"] == "FolgaSmart API"


# --- Employees CRUD
class TestEmployees:
    def test_create_list_delete(self, s):
        r = s.post(f"{API}/employees", json={"name": "TEST_Zé", "role": "Garçom", "sector": "Salão"})
        assert r.status_code == 200
        emp = r.json()
        assert emp["name"] == "TEST_Zé" and emp["sector"] == "Salão"
        assert isinstance(emp["id"], str) and "_id" not in emp
        lst = s.get(f"{API}/employees").json()
        assert any(e["id"] == emp["id"] for e in lst)
        d = s.delete(f"{API}/employees/{emp['id']}")
        assert d.status_code == 200 and d.json()["ok"] is True
        assert not any(e["id"] == emp["id"] for e in s.get(f"{API}/employees").json())
        assert s.delete(f"{API}/employees/{emp['id']}").status_code == 404

    def test_update(self, s):
        emp = s.post(f"{API}/employees", json={"name": "TEST_Up", "role": "A", "sector": "B"}).json()
        r = s.put(f"{API}/employees/{emp['id']}", json={"name": "TEST_Up2", "role": "C", "sector": "D"})
        assert r.status_code == 200 and r.json()["name"] == "TEST_Up2"
        got = [e for e in s.get(f"{API}/employees").json() if e["id"] == emp["id"]][0]
        assert got["role"] == "C" and got["sector"] == "D"
        assert s.put(f"{API}/employees/nope", json={"name": "x", "role": "y", "sector": "z"}).status_code == 404
        s.delete(f"{API}/employees/{emp['id']}")

    @pytest.mark.parametrize("payload", [{"name": "", "role": "a", "sector": "b"}, {"name": "a", "role": "b"}])
    def test_validation(self, s, payload):
        assert s.post(f"{API}/employees", json=payload).status_code == 422

    def test_whitespace_name(self, s):
        # whitespace-only name should ideally be rejected (frontend trims, backend does not)
        r = s.post(f"{API}/employees", json={"name": "   ", "role": "a", "sector": "b"})
        if r.status_code == 200:
            s.delete(f"{API}/employees/{r.json()['id']}")
        pytest.xfail("backend accepts whitespace-only name") if r.status_code == 200 else None


# --- Movement CSV import
def _csv(delim=",", fmt="iso", header=True):
    from datetime import date, timedelta
    rows = [f"data{delim}clientes"] if header else []
    start = date(2026, 4, 6)
    for i in range(14):
        d = start + timedelta(days=i)
        ds = d.isoformat() if fmt == "iso" else d.strftime("%d/%m/%Y")
        rows.append(f"{ds}{delim}{WEEK_VALUES[i % 7]}")
    return "\n".join(rows)


class TestMovement:
    def test_import_comma_iso(self, s):
        r = s.post(f"{API}/movement/import", json={"csv": _csv(",", "iso")})
        assert r.status_code == 200
        m = r.json()
        assert m["avg"] == [float(v) for v in WEEK_VALUES]
        assert m["samples"] == [2] * 7
        assert m["total_records"] == 14
        assert m["peak_days"] == [4, 5, 6]
        assert s.get(f"{API}/movement").json()["peak_days"] == [4, 5, 6]

    def test_import_semicolon_br(self, s):
        r = s.post(f"{API}/movement/import", json={"csv": _csv(";", "br")})
        assert r.status_code == 200
        assert r.json()["avg"] == [float(v) for v in WEEK_VALUES]
        assert r.json()["peak_days"] == [4, 5, 6]

    def test_import_semicolon_decimal_comma(self, s):
        csv = "data;clientes\n06/04/2026;120,5\n07/04/2026;95\n10/04/2026;300"
        r = s.post(f"{API}/movement/import", json={"csv": csv})
        assert r.status_code == 200
        assert r.json()["avg"][0] == 120.5
        assert r.json()["total_records"] == 3

    def test_import_bom(self, s):
        r = s.post(f"{API}/movement/import", json={"csv": "\ufeff" + _csv()})
        assert r.status_code == 200 and r.json()["total_records"] == 14

    @pytest.mark.parametrize("bad", ["", "foo,bar\nbaz,qux", "nada"])
    def test_import_invalid(self, s, bad):
        r = s.post(f"{API}/movement/import", json={"csv": bad})
        assert r.status_code == 400
        assert "Nenhum registro" in r.json()["detail"]

    def test_peaks_put(self, s):
        r = s.put(f"{API}/movement/peaks", json={"peak_days": [5, 5, 9, -1, 0]})
        assert r.status_code == 200 and r.json()["peak_days"] == [0, 5]
        assert s.get(f"{API}/movement").json()["peak_days"] == [0, 5]
        s.put(f"{API}/movement/peaks", json={"peak_days": [4, 5, 6]})


# --- Schedule
class TestSchedule:
    @pytest.mark.parametrize("mode,n", [("6x1", 1), ("5x2", 2)])
    def test_generate(self, s, mode, n):
        s.put(f"{API}/movement/peaks", json={"peak_days": [4, 5, 6]})
        emps = s.get(f"{API}/employees").json()
        r = s.post(f"{API}/schedule/generate", json={"mode": mode})
        assert r.status_code == 200
        sc = r.json()
        assert sc["mode"] == mode
        assert set(sc["off_days"].keys()) == {e["id"] for e in emps}
        for eid, days in sc["off_days"].items():
            assert len(days) == n and len(set(days)) == n
            assert not set(days) & {4, 5, 6}, f"off on peak day {days}"
        # sector spread: within same sector no identical off sets if avoidable
        by_sec = {}
        for e in emps:
            by_sec.setdefault(e["sector"].lower(), []).append(tuple(sc["off_days"][e["id"]]))
        for sec, sets in by_sec.items():
            if len(sets) <= 4 // n:
                assert len(set(sets)) == len(sets), f"sector {sec} duplicates {sets}"
        assert s.get(f"{API}/schedule").json()["mode"] == mode

    def test_generate_invalid_mode(self, s):
        assert s.post(f"{API}/schedule/generate", json={"mode": "4x3"}).status_code == 422

    def test_toggle_cell(self, s):
        sc = s.post(f"{API}/schedule/generate", json={"mode": "6x1"}).json()
        eid = next(iter(sc["off_days"]))
        before = sc["off_days"][eid]
        day = 6 if 6 not in before else 0
        r = s.put(f"{API}/schedule/cell", json={"employee_id": eid, "day": day})
        assert r.status_code == 200 and day in r.json()["off_days"][eid]
        r2 = s.put(f"{API}/schedule/cell", json={"employee_id": eid, "day": day})
        assert r2.json()["off_days"][eid] == before
        assert s.get(f"{API}/schedule").json()["off_days"][eid] == before
        assert s.put(f"{API}/schedule/cell", json={"employee_id": eid, "day": 7}).status_code == 422

    def test_toggle_unknown_employee(self, s):
        r = s.put(f"{API}/schedule/cell", json={"employee_id": "TEST_ghost", "day": 1})
        # ideally 404; current code silently stores orphan key
        status = r.status_code
        if status == 200:
            s.put(f"{API}/schedule/cell", json={"employee_id": "TEST_ghost", "day": 1})
            pytest.xfail("toggle_cell accepts non-existent employee_id (orphan key)")
        assert status == 404

    def test_delete_employee_removes_from_schedule(self, s):
        emp = s.post(f"{API}/employees", json={"name": "TEST_Del", "role": "x", "sector": "Salão"}).json()
        sc = s.post(f"{API}/schedule/generate", json={"mode": "6x1"}).json()
        assert emp["id"] in sc["off_days"]
        s.delete(f"{API}/employees/{emp['id']}")
        assert emp["id"] not in s.get(f"{API}/schedule").json()["off_days"]

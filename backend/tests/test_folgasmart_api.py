# FolgaSmart API regression tests (auth-gated): auth, isolation, employees CRUD, movement import, peaks, schedule
import os
import time
import uuid
import pytest
import requests
from pathlib import Path
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient


def _base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                url = line.split("=", 1)[1].strip()
    return url.rstrip("/")


BASE_URL = _base_url()
API = f"{BASE_URL}/api"
WEEK_VALUES = [120, 95, 100, 130, 210, 260, 180]

_env = dict(l.split("=", 1) for l in Path("/app/backend/.env").read_text().splitlines() if "=" in l)
_mongo = MongoClient(_env["MONGO_URL"].strip('"'))
DB = _mongo[_env["DB_NAME"].strip('"')]


def _make_user(tag):
    ts = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    uid = f"test-user-{tag}-{ts}"
    token = f"test_session_{tag}_{ts}"
    DB.users.insert_one({"user_id": uid, "email": f"test.user.{tag}.{ts}@example.com", "name": f"Test User {tag}",
                         "picture": None, "created_at": datetime.now(timezone.utc)})
    DB.user_sessions.insert_one({"user_id": uid, "session_token": token,
                                 "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                                 "created_at": datetime.now(timezone.utc)})
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return uid, token, s


@pytest.fixture(scope="session")
def users():
    a = _make_user("A")
    b = _make_user("B")
    yield a, b
    for uid, _, _ in (a, b):
        DB.employees.delete_many({"user_id": uid})
        DB.movement.delete_many({"_key": uid})
        DB.schedule.delete_many({"_key": uid})
        DB.user_sessions.delete_many({"user_id": uid})
        DB.users.delete_many({"user_id": uid})


@pytest.fixture(scope="session")
def s(users):
    return users[0][2]


@pytest.fixture(scope="session")
def sb(users):
    return users[1][2]


# --- Health
def test_root():
    r = requests.get(f"{API}/")
    assert r.status_code == 200 and r.json()["message"] == "FolgaSmart API"


# --- Auth
class TestAuth:
    @pytest.mark.parametrize("path", ["/employees", "/movement", "/schedule", "/auth/me"])
    def test_unauth_401(self, path):
        assert requests.get(f"{API}{path}").status_code == 401

    def test_unauth_mutations_401(self):
        assert requests.post(f"{API}/employees", json={"name": "a", "role": "b", "sector": "c"}).status_code == 401
        assert requests.post(f"{API}/schedule/generate", json={"mode": "6x1"}).status_code == 401
        assert requests.put(f"{API}/movement/peaks", json={"peak_days": [1]}).status_code == 401

    def test_bad_token_401(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer nope_invalid"})
        assert r.status_code == 401

    def test_invalid_session_id_401(self):
        r = requests.post(f"{API}/auth/session", json={"session_id": "invalid_xyz"})
        assert r.status_code == 401

    def test_me(self, s, users):
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        d = r.json()
        assert d["user_id"] == users[0][0] and d["name"] == "Test User A" and "_id" not in d

    def test_cookie_auth(self, users):
        r = requests.get(f"{API}/auth/me", cookies={"session_token": users[1][1]})
        assert r.status_code == 200 and r.json()["user_id"] == users[1][0]

    def test_expired_session(self):
        uid, token, sess = _make_user("EXP")
        DB.user_sessions.update_one({"session_token": token},
                                    {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(hours=1)}})
        try:
            assert sess.get(f"{API}/auth/me").status_code == 401
        finally:
            DB.user_sessions.delete_many({"user_id": uid})
            DB.users.delete_many({"user_id": uid})

    def test_logout_cookie(self):
        uid, token, _ = _make_user("LO")
        try:
            r = requests.post(f"{API}/auth/logout", cookies={"session_token": token})
            assert r.status_code == 200 and r.json()["ok"] is True
            assert requests.get(f"{API}/auth/me", cookies={"session_token": token}).status_code == 401
        finally:
            DB.user_sessions.delete_many({"user_id": uid})
            DB.users.delete_many({"user_id": uid})

    def test_new_user_does_not_see_legacy(self, s):
        # legacy employees (no user_id) must not leak to mongosh-created users
        assert s.get(f"{API}/employees").json() == []


# --- Isolation
class TestIsolation:
    def test_employee_isolation(self, s, sb):
        emp = s.post(f"{API}/employees", json={"name": "TEST_Iso", "role": "x", "sector": "Salão"}).json()
        assert not any(e["id"] == emp["id"] for e in sb.get(f"{API}/employees").json())
        assert sb.delete(f"{API}/employees/{emp['id']}").status_code == 404
        assert sb.put(f"{API}/employees/{emp['id']}", json={"name": "h", "role": "h", "sector": "h"}).status_code == 404
        assert sb.put(f"{API}/schedule/cell", json={"employee_id": emp["id"], "day": 1}).status_code == 404
        # still exists for A, unchanged
        got = [e for e in s.get(f"{API}/employees").json() if e["id"] == emp["id"]]
        assert got and got[0]["name"] == "TEST_Iso"
        assert s.delete(f"{API}/employees/{emp['id']}").status_code == 200

    def test_movement_schedule_isolation(self, s, sb):
        s.put(f"{API}/movement/peaks", json={"peak_days": [1, 2]})
        sb.put(f"{API}/movement/peaks", json={"peak_days": [6]})
        assert s.get(f"{API}/movement").json()["peak_days"] == [1, 2]
        assert sb.get(f"{API}/movement").json()["peak_days"] == [6]
        s.post(f"{API}/employees", json={"name": "TEST_S", "role": "x", "sector": "Y"})
        s.post(f"{API}/schedule/generate", json={"mode": "5x2"})
        sb.post(f"{API}/schedule/generate", json={"mode": "6x1"})
        assert s.get(f"{API}/schedule").json()["mode"] == "5x2"
        b_sched = sb.get(f"{API}/schedule").json()
        assert b_sched["mode"] == "6x1" and b_sched["off_days"] == {}


# --- Employees CRUD
class TestEmployees:
    def test_create_list_delete(self, s):
        r = s.post(f"{API}/employees", json={"name": "TEST_Zé", "role": "Garçom", "sector": "Salão"})
        assert r.status_code == 200
        emp = r.json()
        assert emp["name"] == "TEST_Zé" and "_id" not in emp
        assert any(e["id"] == emp["id"] for e in s.get(f"{API}/employees").json())
        assert s.delete(f"{API}/employees/{emp['id']}").status_code == 200
        assert s.delete(f"{API}/employees/{emp['id']}").status_code == 404

    def test_update(self, s):
        emp = s.post(f"{API}/employees", json={"name": "TEST_Up", "role": "A", "sector": "B"}).json()
        r = s.put(f"{API}/employees/{emp['id']}", json={"name": "TEST_Up2", "role": "C", "sector": "D"})
        assert r.status_code == 200 and r.json()["name"] == "TEST_Up2"
        got = [e for e in s.get(f"{API}/employees").json() if e["id"] == emp["id"]][0]
        assert got["role"] == "C" and got["sector"] == "D"
        s.delete(f"{API}/employees/{emp['id']}")

    @pytest.mark.parametrize("payload", [{"name": "", "role": "a", "sector": "b"}, {"name": "a", "role": "b"},
                                         {"name": "   ", "role": "a", "sector": "b"}])
    def test_validation(self, s, payload):
        assert s.post(f"{API}/employees", json=payload).status_code == 422


def _csv(delim=",", fmt="iso"):
    from datetime import date
    rows = [f"data{delim}clientes"]
    start = date(2026, 4, 6)
    for i in range(14):
        d = start + timedelta(days=i)
        ds = d.isoformat() if fmt == "iso" else d.strftime("%d/%m/%Y")
        rows.append(f"{ds}{delim}{WEEK_VALUES[i % 7]}")
    return "\n".join(rows)


class TestMovement:
    def test_import(self, s):
        r = s.post(f"{API}/movement/import", json={"csv": _csv(";", "br")})
        assert r.status_code == 200
        m = r.json()
        assert m["avg"] == [float(v) for v in WEEK_VALUES] and m["peak_days"] == [4, 5, 6]
        assert s.get(f"{API}/movement").json()["total_records"] == 14

    def test_thousands(self, s):
        r = s.post(f"{API}/movement/import", json={"csv": "data;clientes\n06/04/2026;1.234"})
        assert r.status_code == 200 and r.json()["avg"][0] == 1234.0

    def test_import_invalid(self, s):
        r = s.post(f"{API}/movement/import", json={"csv": "nada"})
        assert r.status_code == 400

    def test_peaks_put(self, s):
        r = s.put(f"{API}/movement/peaks", json={"peak_days": [5, 5, 9, -1, 0]})
        assert r.status_code == 200 and r.json()["peak_days"] == [0, 5]
        s.put(f"{API}/movement/peaks", json={"peak_days": [4, 5, 6]})


class TestSchedule:
    @pytest.mark.parametrize("mode,n", [("6x1", 1), ("5x2", 2)])
    def test_generate(self, s, mode, n):
        s.put(f"{API}/movement/peaks", json={"peak_days": [4, 5, 6]})
        for i, sec in enumerate(["Salão", "Salão", "Cozinha"]):
            s.post(f"{API}/employees", json={"name": f"TEST_G{mode}{i}", "role": "x", "sector": sec})
        emps = s.get(f"{API}/employees").json()
        sc = s.post(f"{API}/schedule/generate", json={"mode": mode}).json()
        assert sc["mode"] == mode
        assert set(sc["off_days"].keys()) == {e["id"] for e in emps}
        for days in sc["off_days"].values():
            assert len(days) == n and not set(days) & {4, 5, 6}

    def test_toggle_cell(self, s):
        sc = s.post(f"{API}/schedule/generate", json={"mode": "6x1"}).json()
        eid = next(iter(sc["off_days"]))
        before = sc["off_days"][eid]
        day = 6 if 6 not in before else 0
        assert day in s.put(f"{API}/schedule/cell", json={"employee_id": eid, "day": day}).json()["off_days"][eid]
        s.put(f"{API}/schedule/cell", json={"employee_id": eid, "day": day})
        assert s.get(f"{API}/schedule").json()["off_days"][eid] == before

    def test_toggle_unknown(self, s):
        assert s.put(f"{API}/schedule/cell", json={"employee_id": "TEST_ghost", "day": 1}).status_code == 404

    def test_delete_removes_from_schedule(self, s):
        emp = s.post(f"{API}/employees", json={"name": "TEST_Del", "role": "x", "sector": "Salão"}).json()
        assert emp["id"] in s.post(f"{API}/schedule/generate", json={"mode": "6x1"}).json()["off_days"]
        s.delete(f"{API}/employees/{emp['id']}")
        assert emp["id"] not in s.get(f"{API}/schedule").json()["off_days"]


def test_legacy_data_untouched():
    assert DB.employees.count_documents({"user_id": {"$exists": False}}) == 6
    assert DB.movement.find_one({"_key": "main"}) is not None
    assert DB.schedule.find_one({"_key": "main"}) is not None

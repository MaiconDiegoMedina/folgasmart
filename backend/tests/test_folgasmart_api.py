# FolgaSmart API regression tests (no auth, week-based schedule)
import os
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"
W1 = "2030-03-04"  # Monday
W2 = "2030-03-11"
W3 = "2030-03-18"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def emps(s):
    created = []
    for i, sec in enumerate(["TEST_SecA"] * 3 + ["TEST_SecB"] * 2):
        r = s.post(f"{API}/employees", json={"name": f"TEST_Emp{i}", "role": "Caixa", "sector": sec})
        assert r.status_code == 200
        created.append(r.json())
    yield created
    for e in created:
        s.delete(f"{API}/employees/{e['id']}")


# --- No auth
def test_no_auth_routes(s):
    assert s.get(f"{API}/").status_code == 200
    assert s.get(f"{API}/employees").status_code == 200
    assert s.get(f"{API}/movement").status_code == 200
    assert s.get(f"{API}/auth/me").status_code in (404, 405)
    assert s.post(f"{API}/auth/session", json={}).status_code in (404, 405)


# --- Employees CRUD
def test_employee_crud(s):
    r = s.post(f"{API}/employees", json={"name": "TEST_Crud", "role": "R", "sector": "TEST_X"})
    assert r.status_code == 200
    e = r.json()
    assert "_id" not in e and e["name"] == "TEST_Crud"
    r = s.put(f"{API}/employees/{e['id']}", json={"name": "TEST_Crud2", "role": "R", "sector": "TEST_X"})
    assert r.json()["name"] == "TEST_Crud2"
    assert any(x["name"] == "TEST_Crud2" for x in s.get(f"{API}/employees").json())
    assert s.delete(f"{API}/employees/{e['id']}").status_code == 200
    assert s.delete(f"{API}/employees/{e['id']}").status_code == 404
    assert s.post(f"{API}/employees", json={"name": " ", "role": "R", "sector": "S"}).status_code == 422


# --- Week normalization / validation
def test_week_normalization(s):
    r = s.get(f"{API}/schedule", params={"week": "2030-03-07"})
    assert r.status_code == 200
    assert r.json()["week"] == W1
    r = s.get(f"{API}/schedule", params={"week": "2030-03-10"})  # Sunday
    assert r.json()["week"] == W1


def test_invalid_week(s, emps):
    assert s.get(f"{API}/schedule", params={"week": "abc"}).status_code == 400
    assert s.get(f"{API}/schedule", params={"week": "2030-13-01"}).status_code == 400
    assert s.post(f"{API}/schedule/generate", json={"mode": "6x1", "week": "xx"}).status_code == 400
    assert s.put(f"{API}/schedule/cell", json={"employee_id": emps[0]["id"], "day": 0, "week": "bad"}).status_code == 400
    assert s.get(f"{API}/schedule").status_code == 422


def test_generate_6x1_and_independence(s, emps):
    r = s.post(f"{API}/schedule/generate", json={"mode": "6x1", "week": "2030-03-06"})
    assert r.status_code == 200
    d = r.json()
    assert d["week"] == W1 and d["mode"] == "6x1" and d["generated_at"]
    peaks = set(s.get(f"{API}/movement").json()["peak_days"])
    for e in emps:
        offs = d["off_days"][e["id"]]
        assert len(offs) == 1
        assert not (set(offs) & peaks)
    # different week not touched
    g = s.get(f"{API}/schedule", params={"week": W3 if False else "2030-04-01"}).json()
    assert g["off_days"] == {} and g["generated_at"] is None


def test_generate_5x2(s, emps):
    d = s.post(f"{API}/schedule/generate", json={"mode": "5x2", "week": W2}).json()
    peaks = set(s.get(f"{API}/movement").json()["peak_days"])
    for e in emps:
        offs = d["off_days"][e["id"]]
        assert len(offs) == 2 and len(set(offs)) == 2
        if len(peaks) <= 5:
            assert not (set(offs) & peaks)
    w1 = s.get(f"{API}/schedule", params={"week": W1}).json()
    assert w1["mode"] == "6x1"


def test_ungenerated_week_mode_is_last_generated(s, emps):
    s.post(f"{API}/schedule/generate", json={"mode": "5x2", "week": W2})
    g = s.get(f"{API}/schedule", params={"week": "2030-05-06"}).json()
    assert g["generated_at"] is None and g["off_days"] == {}
    assert g["mode"] == "5x2", f"expected last generated mode 5x2, got {g['mode']}"


def test_rotation_across_weeks(s, emps):
    secA = [e["id"] for e in emps if e["sector"] == "TEST_SecA"]
    results = []
    for wk in [W1, W2, W3]:
        d = s.post(f"{API}/schedule/generate", json={"mode": "6x1", "week": wk}).json()
        results.append(tuple(d["off_days"][i][0] for i in secA))
    assert len(set(results)) > 1, f"rotation did not change assignments: {results}"


def test_toggle_cell_week_scoped(s, emps):
    s.post(f"{API}/schedule/generate", json={"mode": "6x1", "week": W1})
    s.post(f"{API}/schedule/generate", json={"mode": "6x1", "week": W2})
    eid = emps[0]["id"]
    before_w2 = s.get(f"{API}/schedule", params={"week": W2}).json()["off_days"][eid]
    before_w1 = s.get(f"{API}/schedule", params={"week": W1}).json()["off_days"][eid]
    day = (before_w1[0] + 1) % 7
    r = s.put(f"{API}/schedule/cell", json={"employee_id": eid, "day": day, "week": "2030-03-09"})
    assert r.status_code == 200 and r.json()["week"] == W1
    assert day in r.json()["off_days"][eid]
    assert s.get(f"{API}/schedule", params={"week": W2}).json()["off_days"][eid] == before_w2
    r = s.put(f"{API}/schedule/cell", json={"employee_id": eid, "day": day, "week": W1})
    assert day not in r.json()["off_days"][eid]
    assert s.put(f"{API}/schedule/cell", json={"employee_id": "nope", "day": 0, "week": W1}).status_code == 404
    assert s.put(f"{API}/schedule/cell", json={"employee_id": eid, "day": 7, "week": W1}).status_code == 422


def test_delete_employee_removes_from_all_weeks(s):
    e = s.post(f"{API}/employees", json={"name": "TEST_Del", "role": "R", "sector": "TEST_SecA"}).json()
    s.post(f"{API}/schedule/generate", json={"mode": "6x1", "week": W1})
    s.post(f"{API}/schedule/generate", json={"mode": "6x1", "week": W2})
    assert e["id"] in s.get(f"{API}/schedule", params={"week": W1}).json()["off_days"]
    s.delete(f"{API}/employees/{e['id']}")
    for wk in [W1, W2]:
        assert e["id"] not in s.get(f"{API}/schedule", params={"week": wk}).json()["off_days"]


def test_movement_peaks_and_import_restore(s):
    orig = s.get(f"{API}/movement").json()
    try:
        r = s.put(f"{API}/movement/peaks", json={"peak_days": [5, 4, 9, -1]})
        assert r.json()["peak_days"] == [4, 5]
        assert s.post(f"{API}/movement/import", json={"csv": "foo,bar"}).status_code == 400
        csv_text = "data;clientes\n" + "\n".join(
            f"{(date(2026, 4, 6) + timedelta(days=i)).isoformat()};{[100,100,100,100,200,300,100][i % 7]}" for i in range(14))
        r = s.post(f"{API}/movement/import", json={"csv": csv_text})
        assert r.status_code == 200 and 5 in r.json()["peak_days"] and r.json()["total_records"] == 14
    finally:
        # restore user's original movement via direct DB is not possible; re-set peaks only
        s.put(f"{API}/movement/peaks", json={"peak_days": orig["peak_days"]})

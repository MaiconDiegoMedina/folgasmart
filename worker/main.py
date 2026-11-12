import csv
import base64
import hashlib
import hmac
import io
import json
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Dict, List, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints
from starlette.middleware.cors import CORSMiddleware
from workers import asgi


app = FastAPI(title="FolgaSmart API", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://folgasmart.pages.dev"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

Mode = Literal["6x1", "5x2"]
OFFS_PER_MODE = {"6x1": 1, "5x2": 2}
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Status = Literal["ativo", "ferias", "suspensao"]
Gender = Literal["M", "F"]
# Id de uma jornada cadastrada (tabela workloads)
Workload = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


def db(request: Request):
    return request.scope["env"].DB


TOKEN_LIFETIME_SECONDS = 8 * 60 * 60
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_ATTEMPTS = 5


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _secrets(request: Request):
    env = request.scope["env"]
    password = getattr(env, "FOLGASMART_PASSWORD", None)
    signing_key = getattr(env, "FOLGASMART_SESSION_SECRET", None)
    if not password or not signing_key:
        raise HTTPException(503, "A autenticação ainda não foi configurada no Cloudflare.")
    if len(str(password)) < 16 or len(str(signing_key)) < 32:
        raise HTTPException(503, "Configure uma senha com pelo menos 16 caracteres e uma chave forte de sessão.")
    return str(password), str(signing_key)


def _make_token(session_id: str, expiry: int, signing_key: str) -> str:
    payload = _b64encode(json.dumps({"sid": session_id, "exp": expiry}, separators=(",", ":")).encode())
    signature = hmac.new(signing_key.encode(), payload.encode(), hashlib.sha256).digest()
    return f"{payload}.{_b64encode(signature)}"


async def require_auth(request: Request) -> str:
    _, signing_key = _secrets(request)
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Entre para continuar.", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload_part, signature_part = authorization[7:].split(".", 1)
        expected = hmac.new(signing_key.encode(), payload_part.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signature_part)):
            raise ValueError("assinatura inválida")
        payload = json.loads(_b64decode(payload_part))
        session_id = str(payload["sid"])
        expiry = int(payload["exp"])
        if expiry <= int(time.time()):
            raise ValueError("sessão expirada")
    except Exception:
        raise HTTPException(401, "Sessão inválida ou expirada.", headers={"WWW-Authenticate": "Bearer"})
    session = await db(request).prepare(
        "SELECT id FROM auth_sessions WHERE id = ? AND expires_at > ?"
    ).bind(session_id, int(time.time())).first()
    if not session:
        raise HTTPException(401, "Sessão encerrada. Entre novamente.", headers={"WWW-Authenticate": "Bearer"})
    return session_id


_SCHEMA_READY = False
SCHEMA_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS hourly_movement (day INTEGER PRIMARY KEY, label TEXT NOT NULL DEFAULT '',
    hours TEXT NOT NULL, updated_at TEXT)""",
    """CREATE TABLE IF NOT EXISTS shifts (week TEXT NOT NULL, day INTEGER NOT NULL,
    data TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (week, day))""",
    """CREATE TABLE IF NOT EXISTS sector_modes (sector TEXT PRIMARY KEY, mode TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS workloads (id TEXT PRIMARY KEY, name TEXT NOT NULL, minutes TEXT NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 60, minutes_5x2 INTEGER, created_at TEXT NOT NULL)""",
]
DEFAULT_WORKLOADS = [
    ("8h_4h", "8h seg–sex + 4h sáb", [480, 480, 480, 480, 480, 240, 480], 60, 528),
    ("7h20", "7h20 seg–sáb", [440] * 7, 60, 528),
    ("8h48", "8h48 (5x2)", [528] * 7, 60, None),
]
NEW_COLUMNS = [("employees", "gender"), ("employees", "workload"), ("schedule", "sector_modes")]


async def ensure_schema(request: Request) -> None:
    """Cria tabelas e colunas novas no D1 uma vez por instância do worker."""
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    database = db(request)
    for statement in SCHEMA_STATEMENTS:
        await database.prepare(statement).run()
    for table, column in NEW_COLUMNS:
        existing = (await database.prepare(f"PRAGMA table_info({table})").all()).results
        if column not in {row["name"] for row in existing}:
            await database.prepare(f"ALTER TABLE {table} ADD COLUMN {column} TEXT").run()
    if not await database.prepare("SELECT id FROM workloads LIMIT 1").first():
        for index, (wid, name, minutes, break_minutes, minutes_5x2) in enumerate(DEFAULT_WORKLOADS):
            await database.prepare(
                "INSERT INTO workloads (id, name, minutes, break_minutes, minutes_5x2, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(wid, name, json.dumps(minutes), break_minutes, minutes_5x2, f"2000-01-0{index + 1}").run()
    _SCHEMA_READY = True


api = APIRouter(prefix="/api", dependencies=[Depends(require_auth), Depends(ensure_schema)])
auth = APIRouter(prefix="/api/auth")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class EmployeeIn(BaseModel):
    name: Text
    role: Text
    sector: Text
    status: Status = "ativo"
    gender: Gender | None = None
    workload: Workload | None = None


class Employee(EmployeeIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=now_iso)


class Movement(BaseModel):
    avg: List[float] = Field(default_factory=lambda: [0.0] * 7)
    samples: List[int] = Field(default_factory=lambda: [0] * 7)
    peak_days: List[int] = Field(default_factory=list)
    total_records: int = 0
    updated_at: str | None = None


class CsvImport(BaseModel):
    csv: str


class PeaksIn(BaseModel):
    peak_days: List[int]


class Schedule(BaseModel):
    extra_days: Dict[str, List[int]] = Field(default_factory=dict)
    week: str
    mode: Mode = "6x1"
    off_days: Dict[str, List[int]] = Field(default_factory=dict)
    suspension_days: Dict[str, List[int]] = Field(default_factory=dict)
    generated_at: str | None = None
    cct_alerts: Dict[str, str] = Field(default_factory=dict)
    sector_modes: Dict[str, Mode] = Field(default_factory=dict)
    streak_alerts: Dict[str, List[int]] = Field(default_factory=dict)


class WorkloadIn(BaseModel):
    name: Text
    minutes: List[int] = Field(min_length=7, max_length=7)
    break_minutes: int = Field(default=60, ge=0, le=240)
    minutes_5x2: int | None = Field(default=None, ge=0, le=1440)


class WorkloadOut(WorkloadIn):
    id: str


class EmployeesImport(BaseModel):
    employees: List[EmployeeIn] = Field(min_length=1, max_length=2000)


class SectorModeIn(BaseModel):
    sector: Text
    mode: Mode


class GenerateIn(BaseModel):
    mode: Mode
    week: str


class CellToggle(BaseModel):
    employee_id: str
    day: int = Field(ge=0, le=6)
    week: str
    extra: bool = False



class LoginIn(BaseModel):
    password: str


HHMM = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


class HourPoint(BaseModel):
    hour: int = Field(ge=0, le=23)
    clients: float = Field(ge=0)
    value: float = 0


class HourlyIn(BaseModel):
    day: int = Field(ge=0, le=6)
    label: str = ""
    hours: List[HourPoint] = Field(min_length=1, max_length=24)


class Hourly(HourlyIn):
    updated_at: str | None = None


class ShiftIn(BaseModel):
    week: str
    day: int = Field(ge=0, le=6)
    employee_id: str
    start: HHMM | None = None
    break_start: HHMM | None = None
    break_end: HHMM | None = None
    end: HHMM | None = None


class DayShifts(BaseModel):
    week: str
    day: int
    shifts: Dict[str, List[str]] = Field(default_factory=dict)


def week_start(raw: str) -> str:
    try:
        day = date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(400, "Semana inválida. Use AAAA-MM-DD")
    return (day - timedelta(days=day.weekday())).isoformat()


async def list_employees(request: Request) -> List[Employee]:
    result = await db(request).prepare(
        "SELECT id, name, role, sector, status, gender, workload, created_at FROM employees ORDER BY created_at ASC"
    ).all()
    return [Employee(
        id=row["id"], name=row["name"], role=row["role"], sector=row["sector"],
        status=row["status"], gender=row["gender"] or None, workload=row["workload"] or None,
        created_at=row["created_at"],
    ) for row in result.results]


async def get_movement(request: Request) -> Movement:
    row = await db(request).prepare(
        "SELECT avg, samples, peak_days, total_records, updated_at FROM movement WHERE key = ?"
    ).bind("main").first()
    if not row:
        return Movement()
    return Movement(
        avg=json.loads(row["avg"]), samples=json.loads(row["samples"]),
        peak_days=json.loads(row["peak_days"]), total_records=row["total_records"],
        updated_at=row["updated_at"],
    )


async def save_movement(request: Request, movement: Movement) -> None:
    await db(request).prepare(
        """INSERT INTO movement (key, avg, samples, peak_days, total_records, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET
        avg=excluded.avg, samples=excluded.samples, peak_days=excluded.peak_days,
        total_records=excluded.total_records, updated_at=excluded.updated_at"""
    ).bind("main", json.dumps(movement.avg), json.dumps(movement.samples),
           json.dumps(movement.peak_days), movement.total_records, movement.updated_at).run()


async def get_schedule(request: Request, week: str) -> Schedule:
    row = await db(request).prepare(
        "SELECT week, mode, off_days, suspension_days, generated_at, sector_modes FROM schedule WHERE week = ?"
    ).bind(week).first()
    if row:
        stored_suspensions = json.loads(row["suspension_days"])
        suspensions = {key: [day for day in days if day >= 0] for key, days in stored_suspensions.items()}
        extras = {key: [-day - 1 for day in days if day < 0] for key, days in stored_suspensions.items()}
        return Schedule(
            week=row["week"], mode=row["mode"], off_days=json.loads(row["off_days"]),
            suspension_days=suspensions, extra_days=extras, generated_at=row["generated_at"],
            sector_modes=json.loads(row["sector_modes"] or "{}"),
        )
    last = await db(request).prepare(
        "SELECT mode FROM schedule WHERE generated_at IS NOT NULL ORDER BY generated_at DESC LIMIT 1"
    ).first()
    return Schedule(week=week, mode=last["mode"] if last else "6x1")


async def save_schedule(request: Request, schedule: Schedule) -> None:
    stored_suspensions = {
        emp_id: schedule.suspension_days.get(emp_id, [])
        + [-day - 1 for day in schedule.extra_days.get(emp_id, [])]
        for emp_id in set(schedule.suspension_days) | set(schedule.extra_days)
    }
    await db(request).prepare(
        """INSERT INTO schedule (week, mode, off_days, suspension_days, generated_at, sector_modes)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(week) DO UPDATE SET mode=excluded.mode,
        off_days=excluded.off_days, suspension_days=excluded.suspension_days,
        generated_at=excluded.generated_at, sector_modes=excluded.sector_modes"""
    ).bind(schedule.week, schedule.mode, json.dumps(schedule.off_days),
           json.dumps(stored_suspensions), schedule.generated_at, json.dumps(schedule.sector_modes)).run()


def parse_date(raw: str):
    raw = raw.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass
    return None


def parse_number(raw: str):
    raw = raw.strip()
    if "," in raw or re.fullmatch(r"\d{1,3}(\.\d{3})+", raw):
        raw = raw.replace(".", "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


# CCT: domingos trabalhados (T) e de folga (F) em ciclo
#   homens:   trabalha 2, folga 2
#   mulheres: trabalha 1, folga 1
SUNDAY = 6
SUNDAY_CYCLE = {"M": "TTFF", "F": "TF"}


def sunday_of(schedule: Schedule, emp_id: str) -> str | None:
    if emp_id not in schedule.off_days:
        return None
    off = SUNDAY in schedule.off_days[emp_id] and SUNDAY not in schedule.extra_days.get(emp_id, [])
    return "F" if off else "T"


async def sunday_history(request: Request, week: str, weeks: int = 3) -> List[Schedule]:
    """Escalas das semanas anteriores, da mais recente para a mais antiga."""
    start = date.fromisoformat(week)
    return [await get_schedule(request, (start - timedelta(days=7 * i)).isoformat()) for i in range(1, weeks + 1)]


def sunday_plan(gender: str | None, history: List[str | None], stagger: int) -> str | None:
    """Domingo desta semana (T/F) seguindo o ciclo, encaixado no histórico."""
    cycle = SUNDAY_CYCLE.get(gender or "")
    if not cycle:
        return None
    size = len(cycle)

    def score(phase: int) -> int:
        return sum(1 for back, seen in enumerate(history, 1) if seen and cycle[(phase - back) % size] == seen)

    best = max(range(size), key=lambda phase: (score(phase), -((phase - stagger) % size)))
    return cycle[best]


def sunday_alert(gender: str | None, current: str | None, history: List[str | None]) -> str | None:
    if current != "T" or len(history) < 2:
        return None
    last, before = history[0], history[1]
    if gender == "F" and last == "T":
        return "CCT: 2º domingo seguido trabalhado (mulheres trabalham 1 e folgam 1)."
    if gender == "M" and last == "T" and before == "T":
        return "CCT: 3º domingo seguido trabalhado (homens trabalham 2 e folgam 2)."
    if gender == "M" and last == "F" and before == "T":
        return "CCT: folgou só 1 domingo (homens folgam 2 domingos seguidos)."
    return None


MAX_STREAK = 6


def worked_days(schedule: Schedule, emp_id: str) -> List[bool] | None:
    if emp_id not in schedule.off_days:
        return None
    # EXTRA é computado como folga
    off = set(schedule.off_days[emp_id]) | set(schedule.suspension_days.get(emp_id, []))
    return [day not in off for day in range(7)]


def last_real_off(schedule: Schedule, emp_id: str) -> int | None:
    """Último dia de folga (EXTRA conta como folga) na semana; -1 se não folgou."""
    worked = worked_days(schedule, emp_id)
    if worked is None:
        return None
    offs = [day for day in range(7) if not worked[day]]
    return offs[-1] if offs else -1


def streak_violations(previous: Schedule | None, current: Schedule, emp_id: str) -> List[int]:
    """Dias desta semana que passam do 6º dia seguido de trabalho."""
    now = worked_days(current, emp_id)
    if now is None:
        return []
    before = (worked_days(previous, emp_id) if previous else None) or [False] * 7
    run, days = 0, []
    for index, worked in enumerate(before + now):
        run = run + 1 if worked else 0
        if index >= 7 and run > MAX_STREAK:
            days.append(index - 7)
    return days


async def with_alerts(request: Request, schedule: Schedule, employees: List[Employee] | None = None,
                      history: List[Schedule] | None = None) -> Schedule:
    employees = employees if employees is not None else await list_employees(request)
    history = history if history is not None else await sunday_history(request, schedule.week, 2)
    schedule.cct_alerts = {}
    schedule.streak_alerts = {}
    for emp in employees:
        if emp.status == "ferias":
            continue
        alert = sunday_alert(emp.gender, sunday_of(schedule, emp.id), [sunday_of(h, emp.id) for h in history])
        if alert:
            schedule.cct_alerts[emp.id] = alert
        streak = streak_violations(history[0] if history else None, schedule, emp.id)
        if streak:
            schedule.streak_alerts[emp.id] = streak
    return schedule


def compute_schedule(employees: List[Employee], movement: Movement, mode: str,
                     rotate: int = 0, previous_days: dict | None = None,
                     sunday_rule: Dict[str, str] | None = None,
                     sector_modes: Dict[str, str] | None = None) -> Dict[str, List[int]]:
    max_avg = max(movement.avg) or 1
    weight = [1 + 4 * (value / max_avg) for value in movement.avg]
    peaks = set(movement.peak_days)
    off_sector: Dict[str, List[int]] = {}
    result: Dict[str, List[int]] = {}
    holiday = [e for e in employees if e.status == "ferias"]
    active = [e for e in employees if e.status in ("ativo", "suspensao")]
    for emp in holiday:
        result[emp.id] = list(range(7))
    ordered = []
    for sector in sorted({e.sector.lower() for e in active}):
        group = sorted([e for e in active if e.sector.lower() == sector], key=lambda e: e.created_at)
        k = rotate % len(group) if group else 0
        ordered.extend(group[k:] + group[:k])
    for emp in ordered:
        sec = off_sector.setdefault(emp.sector.lower(), [0] * 7)
        offs_needed = OFFS_PER_MODE[(sector_modes or {}).get(emp.sector.lower(), mode)]
        # Último dia de folga da semana anterior (6 = domingo, sem restrição se não houver histórico)
        last_day = (previous_days or {}).get(emp.id, SUNDAY)
        rule = (sunday_rule or {}).get(emp.id)
        # Folga de domingo pela CCT e a semana anterior terminou cedo: no 6x1 só um dia de folga
        # não cumpre as duas regras, então ganha uma folga a mais
        if rule == "F" and last_day < SUNDAY and offs_needed == 1:
            offs_needed = 2
        chosen = []
        for pick in range(offs_needed):
            def cost(day):
                # Só as folgas do próprio setor contam: um setor não interfere no outro
                value = (sec[day] + 1) * weight[day] + sec[day] * 6
                if day in peaks:
                    value += 1000
                # No máximo 6 dias seguidos: a primeira folga precisa vir até o dia last_day
                if pick == offs_needed - 1 and not any(d <= last_day for d in chosen) and day > last_day:
                    value += 1000000 + 1000 * (day - last_day)
                # Regra de domingos da CCT tem prioridade sobre as demais
                if rule == "F" and SUNDAY not in chosen and day != SUNDAY:
                    value += 100000
                if rule == "T" and day == SUNDAY:
                    value += 100000
                return value
            day = min((d for d in range(7) if d not in chosen), key=lambda d: (cost(d), d))
            chosen.append(day)
            sec[day] += 1
        result[emp.id] = sorted(chosen)
    return result


@auth.post("/login")
async def login(data: LoginIn, request: Request):
    expected_password, signing_key = _secrets(request)
    database = db(request)
    now = int(time.time())
    client_ip = request.headers.get("cf-connecting-ip", "unknown")
    await database.prepare(
        "DELETE FROM auth_attempts WHERE window_started <= ?"
    ).bind(now - LOGIN_WINDOW_SECONDS).run()
    attempt = await database.prepare(
        "SELECT window_started, attempts FROM auth_attempts WHERE ip = ?"
    ).bind(client_ip).first()
    window_started = int(attempt["window_started"]) if attempt else now
    attempts = int(attempt["attempts"]) if attempt else 0
    if now - window_started >= LOGIN_WINDOW_SECONDS:
        window_started, attempts = now, 0
    if attempts >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(429, "Muitas tentativas. Aguarde 15 minutos e tente novamente.")
    if not hmac.compare_digest(data.password.encode(), expected_password.encode()):
        attempts += 1
        await database.prepare(
            """INSERT INTO auth_attempts (ip, window_started, attempts) VALUES (?, ?, ?)
            ON CONFLICT(ip) DO UPDATE SET window_started=excluded.window_started,
            attempts=excluded.attempts"""
        ).bind(client_ip, window_started, attempts).run()
        raise HTTPException(401, "Senha incorreta.")

    await database.prepare("DELETE FROM auth_attempts WHERE ip = ?").bind(client_ip).run()
    await database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now).run()
    session_id = str(uuid.uuid4())
    expires_at = now + TOKEN_LIFETIME_SECONDS
    await database.prepare(
        "INSERT INTO auth_sessions (id, expires_at) VALUES (?, ?)"
    ).bind(session_id, expires_at).run()
    return {
        "access_token": _make_token(session_id, expires_at, signing_key),
        "token_type": "bearer",
        "expires_in": TOKEN_LIFETIME_SECONDS,
    }


@auth.get("/me")
async def current_session(session_id: str = Depends(require_auth)):
    return {"authenticated": True}


@auth.post("/logout")
async def logout(request: Request, session_id: str = Depends(require_auth)):
    await db(request).prepare("DELETE FROM auth_sessions WHERE id = ?").bind(session_id).run()
    return {"ok": True}


@api.get("/")
async def root():
    return {"message": "FolgaSmart API (Cloudflare D1)"}


@api.get("/employees", response_model=List[Employee])
async def employees(request: Request):
    return await list_employees(request)


@api.post("/employees", response_model=Employee)
async def create_employee(data: EmployeeIn, request: Request):
    emp = Employee(**data.model_dump())
    await db(request).prepare(
        "INSERT INTO employees (id, name, role, sector, status, gender, workload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(emp.id, emp.name, emp.role, emp.sector, emp.status, emp.gender, emp.workload, emp.created_at).run()
    return emp


@api.put("/employees/{emp_id}", response_model=Employee)
async def update_employee(emp_id: str, data: EmployeeIn, request: Request):
    database = db(request)
    existing = await database.prepare("SELECT id, created_at FROM employees WHERE id = ?").bind(emp_id).first()
    if not existing:
        raise HTTPException(404, "Funcionário não encontrado")
    await database.prepare(
        "UPDATE employees SET name=?, role=?, sector=?, status=?, gender=?, workload=? WHERE id=?"
    ).bind(data.name, data.role, data.sector, data.status, data.gender, data.workload, emp_id).run()
    return Employee(id=emp_id, created_at=existing["created_at"], **data.model_dump())


@api.delete("/employees/{emp_id}")
async def delete_employee(emp_id: str, request: Request):
    database = db(request)
    if not await database.prepare("SELECT id FROM employees WHERE id = ?").bind(emp_id).first():
        raise HTTPException(404, "Funcionário não encontrado")
    schedules = (await database.prepare("SELECT week, off_days, suspension_days FROM schedule").all()).results
    for row in schedules:
        off = json.loads(row["off_days"])
        suspension = json.loads(row["suspension_days"])
        off.pop(emp_id, None)
        suspension.pop(emp_id, None)
        await database.prepare(
            "UPDATE schedule SET off_days=?, suspension_days=? WHERE week=?"
        ).bind(json.dumps(off), json.dumps(suspension), row["week"]).run()
    await database.prepare("DELETE FROM employees WHERE id = ?").bind(emp_id).run()
    return {"ok": True}


@api.get("/movement", response_model=Movement)
async def movement_api(request: Request):
    return await get_movement(request)


@api.post("/movement/import", response_model=Movement)
async def import_movement(data: CsvImport, request: Request):
    text = data.csv.lstrip("\ufeff")
    delimiter = ";" if text.count(";") > text.count(",") else ","
    totals, counts, records = [0.0] * 7, [0] * 7, 0
    for row in csv.reader(io.StringIO(text), delimiter=delimiter):
        if len(row) < 2:
            continue
        parsed, value = parse_date(row[0]), parse_number(row[1])
        if parsed is None or value is None:
            continue
        totals[parsed.weekday()] += value
        counts[parsed.weekday()] += 1
        records += 1
    if records == 0:
        raise HTTPException(400, "Nenhum registro válido encontrado.")
    averages = [round(totals[i] / counts[i], 1) if counts[i] else 0.0 for i in range(7)]
    mean = sum(averages) / 7
    peaks = sorted([i for i in range(7) if averages[i] >= mean * 1.15], key=lambda i: -averages[i])[:3]
    if not peaks:
        peaks = [max(range(7), key=lambda i: averages[i])]
    mov = Movement(avg=averages, samples=counts, peak_days=sorted(peaks),
                   total_records=records, updated_at=now_iso())
    await save_movement(request, mov)
    return mov


@api.put("/movement/peaks", response_model=Movement)
async def set_peaks(data: PeaksIn, request: Request):
    mov = await get_movement(request)
    mov.peak_days = sorted({day for day in data.peak_days if 0 <= day <= 6})
    mov.updated_at = now_iso()
    await save_movement(request, mov)
    return mov


@api.get("/workloads", response_model=List[WorkloadOut])
async def workloads_api(request: Request):
    rows = (await db(request).prepare(
        "SELECT id, name, minutes, break_minutes, minutes_5x2 FROM workloads ORDER BY created_at"
    ).all()).results
    return [WorkloadOut(id=row["id"], name=row["name"], minutes=json.loads(row["minutes"]),
                        break_minutes=row["break_minutes"], minutes_5x2=row["minutes_5x2"]) for row in rows]


@api.post("/workloads", response_model=WorkloadOut)
async def create_workload(data: WorkloadIn, request: Request):
    if any(not 0 <= m <= 1440 for m in data.minutes):
        raise HTTPException(400, "Horas por dia inválidas.")
    item = WorkloadOut(id=str(uuid.uuid4()), **data.model_dump())
    await db(request).prepare(
        "INSERT INTO workloads (id, name, minutes, break_minutes, minutes_5x2, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(item.id, item.name, json.dumps(item.minutes), item.break_minutes, item.minutes_5x2, now_iso()).run()
    return item


@api.delete("/workloads/{workload_id}")
async def delete_workload(workload_id: str, request: Request):
    database = db(request)
    await database.prepare("DELETE FROM workloads WHERE id = ?").bind(workload_id).run()
    await database.prepare("UPDATE employees SET workload = NULL WHERE workload = ?").bind(workload_id).run()
    return {"ok": True}


@api.post("/employees/import")
async def import_employees(data: EmployeesImport, request: Request):
    """Cadastra em lote; quem já existe com o mesmo nome é ignorado."""
    existing = {e.name.strip().lower() for e in await list_employees(request)}
    created = 0
    for item in data.employees:
        key = item.name.strip().lower()
        if key in existing:
            continue
        emp = Employee(**item.model_dump())
        await db(request).prepare(
            "INSERT INTO employees (id, name, role, sector, status, gender, workload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(emp.id, emp.name, emp.role, emp.sector, emp.status, emp.gender, emp.workload, emp.created_at).run()
        existing.add(key)
        created += 1
    return {"created": created, "skipped": len(data.employees) - created}


async def get_sector_modes(request: Request) -> Dict[str, str]:
    rows = (await db(request).prepare("SELECT sector, mode FROM sector_modes").all()).results
    return {row["sector"].lower(): row["mode"] for row in rows}


@api.get("/sectors/modes")
async def sector_modes_api(request: Request):
    return await get_sector_modes(request)


@api.put("/sectors/mode")
async def set_sector_mode(data: SectorModeIn, request: Request):
    await db(request).prepare(
        """INSERT INTO sector_modes (sector, mode) VALUES (?, ?)
        ON CONFLICT(sector) DO UPDATE SET mode=excluded.mode"""
    ).bind(data.sector.lower(), data.mode).run()
    return await get_sector_modes(request)


@api.get("/schedule", response_model=Schedule)
async def schedule_api(week: str, request: Request):
    return await with_alerts(request, await get_schedule(request, week_start(week)))


@api.post("/schedule/generate", response_model=Schedule)
async def generate(data: GenerateIn, request: Request):
    week = week_start(data.week)
    employees = await list_employees(request)
    mov = await get_movement(request)
    week_date = date.fromisoformat(week)
    previous_week = (week_date - timedelta(days=7)).isoformat()
    rotate = week_date.isocalendar()[1]
    history = await sunday_history(request, week, 3)
    previous_days = {}
    for emp in employees:
        last = last_real_off(history[0], emp.id)
        if last is not None:
            previous_days[emp.id] = last
    sector_modes = await get_sector_modes(request)
    snapshot = {}
    for emp in employees:
        snapshot[emp.sector] = sector_modes.get(emp.sector.lower(), "6x1")
    sunday_rule = {}
    for emp in employees:
        if emp.status == "ferias" or not emp.gender:
            continue
        same = sorted([e for e in employees if e.sector.lower() == emp.sector.lower() and e.gender == emp.gender
                       and e.status != "ferias"], key=lambda e: e.created_at)
        plan = sunday_plan(emp.gender, [sunday_of(h, emp.id) for h in history], rotate + same.index(emp))
        if plan:
            sunday_rule[emp.id] = plan
    sched = Schedule(
        week=week, mode=data.mode, generated_at=now_iso(),
        off_days=compute_schedule(employees, mov, data.mode, rotate, previous_days, sunday_rule,
                                  {k.lower(): v for k, v in snapshot.items()}),
        sector_modes=snapshot,
    )
    await save_schedule(request, sched)
    return await with_alerts(request, sched, employees, history[:2])


@api.put("/schedule/cell", response_model=Schedule)
async def toggle_cell(data: CellToggle, request: Request):
    employee = await db(request).prepare("SELECT status FROM employees WHERE id = ?").bind(data.employee_id).first()
    if not employee:
        raise HTTPException(404, "Funcionário não encontrado")
    sched = await get_schedule(request, week_start(data.week))
    off = list(sched.off_days.get(data.employee_id, []))
    suspension = list(sched.suspension_days.get(data.employee_id, []))
    extra = list(sched.extra_days.get(data.employee_id, []))

    if data.extra:
        if employee["status"] != "ativo":
            raise HTTPException(400, "A marcação EXTRA só pode ser usada para funcionário ativo.")
        if data.day not in off:
            raise HTTPException(400, "EXTRA só pode ser marcado em um dia de folga.")
        if data.day in extra:
            extra.remove(data.day)
        else:
            extra.append(data.day)
    elif data.day in extra:
        extra.remove(data.day)
    elif employee["status"] == "suspensao":
        if data.day not in off and data.day not in suspension:
            off.append(data.day)
        elif data.day in off:
            off.remove(data.day)
            suspension.append(data.day)
        else:
            suspension.remove(data.day)
    elif data.day in off:
        off.remove(data.day)
    else:
        if data.day in suspension:
            suspension.remove(data.day)
        off.append(data.day)

    sched.off_days[data.employee_id] = sorted(off)
    sched.suspension_days[data.employee_id] = sorted(suspension)
    sched.extra_days[data.employee_id] = sorted(extra)
    await save_schedule(request, sched)
    return await with_alerts(request, sched)



@api.get("/hourly", response_model=List[Hourly])
async def hourly_api(request: Request):
    rows = (await db(request).prepare(
        "SELECT day, label, hours, updated_at FROM hourly_movement ORDER BY day"
    ).all()).results
    return [Hourly(day=row["day"], label=row["label"] or "", hours=json.loads(row["hours"]),
                   updated_at=row["updated_at"]) for row in rows]


@api.put("/hourly", response_model=Hourly)
async def save_hourly(data: HourlyIn, request: Request):
    hours = sorted({h.hour: h for h in data.hours}.values(), key=lambda h: h.hour)
    item = Hourly(day=data.day, label=data.label.strip()[:120], hours=hours, updated_at=now_iso())
    await db(request).prepare(
        """INSERT INTO hourly_movement (day, label, hours, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET label=excluded.label, hours=excluded.hours,
        updated_at=excluded.updated_at"""
    ).bind(item.day, item.label, json.dumps([h.model_dump() for h in item.hours]), item.updated_at).run()
    return item


@api.delete("/hourly/{day}")
async def delete_hourly(day: int, request: Request):
    await db(request).prepare("DELETE FROM hourly_movement WHERE day = ?").bind(day).run()
    return {"ok": True}


async def get_shifts(request: Request, week: str, day: int) -> DayShifts:
    row = await db(request).prepare(
        "SELECT data FROM shifts WHERE week = ? AND day = ?"
    ).bind(week, day).first()
    return DayShifts(week=week, day=day, shifts=json.loads(row["data"]) if row else {})


@api.get("/shifts", response_model=DayShifts)
async def shifts_api(week: str, day: int, request: Request):
    if not 0 <= day <= 6:
        raise HTTPException(400, "Dia inválido")
    return await get_shifts(request, week_start(week), day)


@api.put("/shifts", response_model=DayShifts)
async def set_shift(data: ShiftIn, request: Request):
    week = week_start(data.week)
    current = await get_shifts(request, week, data.day)
    if data.start and data.end:
        if data.end <= data.start:
            raise HTTPException(400, "A saída precisa ser depois da entrada.")
        if bool(data.break_start) != bool(data.break_end):
            raise HTTPException(400, "Informe a saída e a volta do intervalo.")
        if data.break_start:
            if not data.start <= data.break_start < data.break_end <= data.end:
                raise HTTPException(400, "O intervalo precisa ficar dentro do expediente.")
            current.shifts[data.employee_id] = [data.start, data.break_start, data.break_end, data.end]
        else:
            current.shifts[data.employee_id] = [data.start, data.end]
    else:
        current.shifts.pop(data.employee_id, None)
    await db(request).prepare(
        """INSERT INTO shifts (week, day, data) VALUES (?, ?, ?)
        ON CONFLICT(week, day) DO UPDATE SET data=excluded.data"""
    ).bind(week, data.day, json.dumps(current.shifts)).run()
    return current


app.include_router(auth)
app.include_router(api)
Default = asgi.entrypoint(app)

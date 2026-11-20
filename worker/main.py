import csv
import asyncio
import base64
import hashlib
import hmac
import io
import json
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, Dict, List, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints, model_validator
from starlette.middleware.cors import CORSMiddleware
from workers import asgi


app = FastAPI(title="FolgaSmart API", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://folgasmart.pages.dev"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Unlock"],
)

# Escala (modelo cadastrado em scale_models): "6x1", "5x2", "5x2-42h" ou um id criado pelo administrador
Mode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
OFFS_PER_MODE = {"6x1": 1, "5x2": 2}  # padrão; o restante vem de scale_models (7 - dias de trabalho)
# Troca automática para 5x2 com 42h semanais
REFORM_WEEK = "2026-12-14"
REFORM_MODE = "5x2-42h"
# Modelos que já vêm no sistema: (id, nome, dias de trabalho, minutos na semana; None = segue a jornada)
BUILTIN_MODELS = [
    ("6x1", "6x1", 6, None),
    ("5x2", "5x2", 5, None),
    (REFORM_MODE, "5x2 · 42h", 5, 42 * 60),
]
LEGACY_WEEK = "2000-01-03"  # segunda-feira usada para a escala que valia antes das datas de início
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Status = Literal["ativo", "ferias", "suspensao", "falta", "inativo"]
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


# Dias anteriores a hoje (horário de Brasília) ficam bloqueados
BR_TZ = timezone(timedelta(hours=-3))
ADMIN_UNLOCK_SECONDS = 30 * 60
LOCKED_MSG = ("Dia já passou: a escala está bloqueada. Só dá para lançar falta ou atestado. "
              "Para alterar, desbloqueie com a senha do administrador.")


def today_br() -> date:
    return datetime.now(BR_TZ).date()


def is_past(week: str, day: int) -> bool:
    return date.fromisoformat(week) + timedelta(days=day) < today_br()


def admin_unlocked(request: Request) -> bool:
    token = request.headers.get("x-admin-unlock", "")
    if not token:
        return False
    try:
        _, signing_key = _secrets(request)
        payload_part, signature_part = token.split(".", 1)
        expected = hmac.new(signing_key.encode(), f"adm.{payload_part}".encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signature_part)):
            return False
        payload = json.loads(_b64decode(payload_part))
        return bool(payload.get("adm")) and int(payload["exp"]) > int(time.time())
    except Exception:
        return False


def ensure_unlocked(request: Request, week: str, day: int):
    if is_past(week, day) and not admin_unlocked(request):
        raise HTTPException(423, LOCKED_MSG)


def require_admin(request: Request):
    """Configurações: só com a senha do administrador (até existirem usuários com perfil)."""
    if not admin_unlocked(request):
        raise HTTPException(423, "Configurações só podem ser alteradas pelo administrador. Informe a senha do administrador.")


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
_SCHEMA_LOCK = asyncio.Lock()
SCHEMA_VERSION = "2026-11-20.2"  # mude ao alterar SCHEMA_STATEMENTS, NEW_COLUMNS ou a migração
SCHEMA_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS hourly_movement (day INTEGER PRIMARY KEY, label TEXT NOT NULL DEFAULT '',
    hours TEXT NOT NULL, updated_at TEXT)""",
    """CREATE TABLE IF NOT EXISTS shifts (week TEXT NOT NULL, day INTEGER NOT NULL,
    data TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (week, day))""",
    """CREATE TABLE IF NOT EXISTS sector_modes (sector TEXT PRIMARY KEY, mode TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS vacations (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL,
    start TEXT NOT NULL, end TEXT NOT NULL, created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS workloads (id TEXT PRIMARY KEY, name TEXT NOT NULL, minutes TEXT NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 60, minutes_5x2 INTEGER, created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS checkouts (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS holidays (date TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0)""",
    """CREATE TABLE IF NOT EXISTS checkout_assign (week TEXT NOT NULL, day INTEGER NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (week, day))""",
    """CREATE TABLE IF NOT EXISTS hourly_week (week TEXT NOT NULL, day INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '',
    hours TEXT NOT NULL, updated_at TEXT, PRIMARY KEY (week, day))""",
    """CREATE TABLE IF NOT EXISTS sectors (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS scale_models (id TEXT PRIMARY KEY, name TEXT NOT NULL, work_days INTEGER NOT NULL,
    weekly_minutes INTEGER, builtin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS sector_mode_changes (id TEXT PRIMARY KEY, sector TEXT NOT NULL, mode TEXT NOT NULL,
    start_week TEXT NOT NULL, created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)""",
]
DEFAULT_WORKLOADS = [
    ("8h_4h", "8h seg–sex + 4h sáb", [480, 480, 480, 480, 480, 240, 480], 60, 528),
    ("7h20", "7h20 seg–sáb", [440] * 7, 60, 528),
    ("8h48", "8h48 (5x2)", [528] * 7, 60, None),
]
NEW_COLUMNS = [("employees", "gender"), ("employees", "workload"), ("schedule", "sector_modes"),
               ("schedule", "absence_days"), ("employees", "contract"), ("schedule", "convocations"),
               ("workloads", "times"), ("workloads", "times_5x2"),
               ("vacations", "kind"), ("movement", "source")]


async def ensure_schema(request: Request) -> None:
    """Atualiza o banco uma vez. Cada pedido custa 1 consulta (a versão gravada); a atualização completa
    só roda quando a versão muda. Pode rodar em paralelo sem duplicar nada (índices únicos + OR IGNORE)."""
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    async with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        database = db(request)
        try:
            row = await database.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").first()
            if row and row["value"] == SCHEMA_VERSION:
                _SCHEMA_READY = True
                return
        except Exception:
            pass  # banco antigo, sem app_settings
        await migrate_schema(database)
        await database.prepare(
            """INSERT INTO app_settings (key, value) VALUES ('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value"""
        ).bind(SCHEMA_VERSION).run()
        _SCHEMA_READY = True


async def migrate_schema(database) -> None:
    # Poucas consultas: o plano gratuito do D1 aceita 50 por pedido
    tables = {r["name"] for r in (await database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'").all()).results}
    for statement in SCHEMA_STATEMENTS:
        name = statement.split("EXISTS", 1)[1].split("(", 1)[0].strip()
        if name not in tables:
            await database.prepare(statement).run()
    columns = (await database.prepare(
        "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'"
    ).all()).results
    existing = {(r["t"], r["c"]) for r in columns}
    for table, column in NEW_COLUMNS:
        if (table, column) not in existing:
            await database.prepare(f"ALTER TABLE {table} ADD COLUMN {column} TEXT").run()
    await database.prepare(
        "UPDATE employees SET contract = 'intermitente' WHERE contract IS NULL AND lower(role) LIKE '%intermitente%'"
    ).run()
    if not await database.prepare("SELECT id FROM workloads LIMIT 1").first():
        for index, (wid, name, minutes, break_minutes, minutes_5x2) in enumerate(DEFAULT_WORKLOADS):
            await database.prepare(
                "INSERT INTO workloads (id, name, minutes, break_minutes, minutes_5x2, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(wid, name, json.dumps(minutes), break_minutes, minutes_5x2, f"2000-01-0{index + 1}").run()
    for index, (mid, name, work_days, weekly) in enumerate(BUILTIN_MODELS):
        await database.prepare(
            """INSERT OR IGNORE INTO scale_models (id, name, work_days, weekly_minutes, builtin, created_at)
            VALUES (?, ?, ?, ?, 1, ?)"""
        ).bind(mid, name, work_days, weekly, f"2000-01-0{index + 1}").run()
    # Remove repetições (versão anterior podia gravar em dobro com pedidos simultâneos) e impede novas
    await database.prepare(
        "DELETE FROM sectors WHERE rowid NOT IN (SELECT min(rowid) FROM sectors GROUP BY lower(trim(name)))").run()
    await database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS sectors_name_uq ON sectors (lower(trim(name)))").run()
    await database.prepare(
        """DELETE FROM sector_mode_changes WHERE rowid NOT IN
        (SELECT min(rowid) FROM sector_mode_changes GROUP BY sector, start_week)""").run()
    await database.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS mode_changes_uq ON sector_mode_changes (sector, start_week)").run()
    # Setores: cadastra os que os funcionários já usam
    await database.prepare(
        """INSERT OR IGNORE INTO sectors (id, name, created_at)
        SELECT lower(hex(randomblob(16))), trim(sector), ? FROM employees
        WHERE trim(COALESCE(sector, '')) <> '' GROUP BY lower(trim(sector))"""
    ).bind(now_iso()).run()
    # Uma vez só: a escala de cada setor passa a ter data de início, e entra a troca de 14/12 (5x2 com 42h)
    if not await database.prepare("SELECT value FROM app_settings WHERE key = 'mode_changes_v1'").first():
        await database.prepare(
            """INSERT OR IGNORE INTO sector_mode_changes (id, sector, mode, start_week, created_at)
            SELECT lower(hex(randomblob(16))), lower(sector), mode, ?, ? FROM sector_modes"""
        ).bind(LEGACY_WEEK, now_iso()).run()
        await database.prepare(
            "INSERT OR IGNORE INTO sector_mode_changes (id, sector, mode, start_week, created_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(str(uuid.uuid4()), "*", REFORM_MODE, REFORM_WEEK, now_iso()).run()
        await database.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mode_changes_v1', ?)").bind(
            now_iso()).run()


api = APIRouter(prefix="/api", dependencies=[Depends(require_auth), Depends(ensure_schema)])
auth = APIRouter(prefix="/api/auth")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


Contract = Literal["efetivo", "intermitente"]


class EmployeeIn(BaseModel):
    name: Text
    role: Text
    sector: Text
    status: Status = "ativo"
    gender: Gender | None = None
    workload: Workload | None = None
    contract: Contract | None = None

    @model_validator(mode="after")
    def default_contract(self):
        # Sem contrato informado: intermitente se o cargo disser, senão efetivo
        if self.contract is None:
            self.contract = "intermitente" if "intermitente" in self.role.lower() else "efetivo"
        return self


class Employee(EmployeeIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=now_iso)


class Movement(BaseModel):
    avg: List[float] = Field(default_factory=lambda: [0.0] * 7)
    samples: List[int] = Field(default_factory=lambda: [0] * 7)
    peak_days: List[int] = Field(default_factory=list)
    total_records: int = 0
    updated_at: str | None = None
    week: str | None = None  # semana dona destes dados (None = importação antiga, sem semana)
    source_week: str | None = None  # semana em que o CSV foi importado


class CsvImport(BaseModel):
    csv: str
    week: str | None = None


class PeaksIn(BaseModel):
    peak_days: List[int]
    week: str | None = None


class Schedule(BaseModel):
    extra_days: Dict[str, List[int]] = Field(default_factory=dict)
    week: str
    mode: Mode = "6x1"
    off_days: Dict[str, List[int]] = Field(default_factory=dict)
    suspension_days: Dict[str, List[int]] = Field(default_factory=dict)
    absence_days: Dict[str, List[int]] = Field(default_factory=dict)
    # Intermitente: {funcionário: {"dia": {"status": "pending|accepted|declined", "at": "AAAA-MM-DD"}}}
    convocations: Dict[str, Dict[str, Dict[str, str]]] = Field(default_factory=dict)
    # Calculado a partir dos períodos de férias (não é gravado na escala)
    vacation_days: Dict[str, List[int]] = Field(default_factory=dict)
    # Calculado a partir dos atestados
    sick_days: Dict[str, List[int]] = Field(default_factory=dict)
    # Calculado: feriados da semana {"dia": {"name", "kind", "closed"}} e dias com a loja fechada
    holidays: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    closed_days: List[int] = Field(default_factory=list)
    generated_at: str | None = None
    cct_alerts: Dict[str, str] = Field(default_factory=dict)
    sector_modes: Dict[str, Mode] = Field(default_factory=dict)
    streak_alerts: Dict[str, List[int]] = Field(default_factory=dict)


HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _mins(t: str) -> int:
    return int(t[:2]) * 60 + int(t[3:])


def normalize_day(times: List[str] | None) -> List[str] | None:
    """Horários do ponto num dia: [entrada, saída] ou [entrada, saída int., volta int., saída]; None = não trabalha."""
    if not times or not any(times):
        return None
    if len(times) == 4:
        start, bs, be, end = times
    elif len(times) == 2:
        start, bs, be, end = times[0], "", "", times[1]
    else:
        raise ValueError("Cada dia precisa de entrada, intervalo e saída.")
    if not start or not end:
        raise ValueError("Informe a entrada e a saída de cada dia trabalhado.")
    for t in (start, bs, be, end):
        if t and not HHMM_RE.match(t):
            raise ValueError(f"Horário inválido: {t}")
    if end <= start:
        raise ValueError("A saída precisa ser depois da entrada.")
    if bool(bs) != bool(be):
        raise ValueError("Informe a saída e a volta do intervalo.")
    if bs:
        if not start <= bs < be <= end:
            raise ValueError("O intervalo precisa ficar dentro do expediente.")
        return [start, bs, be, end]
    return [start, end]


def day_minutes(times: List[str] | None) -> int:
    if not times:
        return 0
    worked = _mins(times[-1]) - _mins(times[0])
    return worked - (_mins(times[2]) - _mins(times[1]) if len(times) == 4 else 0)


class WorkloadIn(BaseModel):
    name: Text
    minutes: List[int] = Field(default_factory=lambda: [0] * 7)
    break_minutes: int = Field(default=60, ge=0, le=240)
    minutes_5x2: int | None = Field(default=None, ge=0, le=1440)
    # Horários do ponto por dia (seg a dom) e, opcionalmente, o horário usado quando o setor está em 5x2
    times: List[List[str] | None] | None = None
    times_5x2: List[str] | None = None

    @model_validator(mode="after")
    def derive_from_times(self):
        if self.times is not None:
            if len(self.times) != 7:
                raise ValueError("Informe os horários dos 7 dias.")
            self.times = [normalize_day(t) for t in self.times]
            self.minutes = [day_minutes(t) for t in self.times]
            breaks = [_mins(t[2]) - _mins(t[1]) for t in self.times if t and len(t) == 4]
            self.break_minutes = breaks[0] if breaks else 0
        self.times_5x2 = normalize_day(self.times_5x2)
        if self.times_5x2:
            self.minutes_5x2 = day_minutes(self.times_5x2)
        if len(self.minutes) != 7 or any(not 0 <= m <= 1440 for m in self.minutes):
            raise ValueError("Horas por dia inválidas.")
        return self


class WorkloadOut(WorkloadIn):
    id: str


class EmployeesImport(BaseModel):
    employees: List[EmployeeIn] = Field(min_length=1, max_length=2000)


class VacationIn(BaseModel):
    employee_id: str
    start: str
    end: str
    kind: Literal["ferias", "atestado"] = "ferias"


class Vacation(VacationIn):
    id: str


class SectorModeIn(BaseModel):
    sector: Text
    mode: Mode
    week: str | None = None  # semana a partir da qual vale (padrão: a atual)


class GenerateIn(BaseModel):
    mode: Mode
    week: str
    sector: str | None = None  # gera só este setor e preserva os demais


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
    week: str | None = None


class Hourly(HourlyIn):
    updated_at: str | None = None  # week: semana de onde veio o relatório (None = importação antiga)


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
        "SELECT id, name, role, sector, status, gender, workload, contract, created_at FROM employees ORDER BY created_at ASC"
    ).all()
    return [Employee(
        id=row["id"], name=row["name"], role=row["role"], sector=row["sector"],
        status=row["status"], gender=row["gender"] or None, workload=row["workload"] or None,
        contract=row["contract"] or None,
        created_at=row["created_at"],
    ) for row in result.results]


MOVEMENT_COLS = "key, avg, samples, peak_days, total_records, updated_at, source"


async def get_movement(request: Request, week: str | None = None) -> Movement:
    """Movimento da semana; sem importação nela, o da última semana anterior importada (ou o antigo)."""
    database = db(request)
    row = None
    if week:
        row = await database.prepare(
            f"SELECT {MOVEMENT_COLS} FROM movement WHERE key LIKE '____-__-__' AND key <= ? ORDER BY key DESC LIMIT 1"
        ).bind(week_start(week)).first()
    if not row:
        row = await database.prepare(f"SELECT {MOVEMENT_COLS} FROM movement WHERE key = ?").bind("main").first()
    if not row:
        return Movement()
    key = None if row["key"] == "main" else row["key"]
    return Movement(
        avg=json.loads(row["avg"]), samples=json.loads(row["samples"]),
        peak_days=json.loads(row["peak_days"]), total_records=row["total_records"],
        updated_at=row["updated_at"], week=key, source_week=row["source"] or key,
    )


async def save_movement(request: Request, movement: Movement, key: str = "main") -> None:
    await db(request).prepare(
        """INSERT INTO movement (key, avg, samples, peak_days, total_records, updated_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET
        avg=excluded.avg, samples=excluded.samples, peak_days=excluded.peak_days,
        total_records=excluded.total_records, updated_at=excluded.updated_at, source=excluded.source"""
    ).bind(key, json.dumps(movement.avg), json.dumps(movement.samples),
           json.dumps(movement.peak_days), movement.total_records, movement.updated_at,
           movement.source_week).run()


async def vacation_days_for(request: Request, week: str, kind: str = "ferias") -> Dict[str, List[int]]:
    """Dias da semana (0 = segunda) em férias (ou atestado), por funcionário."""
    start = date.fromisoformat(week)
    end = start + timedelta(days=6)
    rows = (await db(request).prepare(
        "SELECT employee_id, start, end FROM vacations WHERE start <= ? AND end >= ? AND COALESCE(kind, 'ferias') = ?"
    ).bind(end.isoformat(), start.isoformat(), kind).all()).results
    days: Dict[str, set] = {}
    for row in rows:
        first, last = date.fromisoformat(row["start"]), date.fromisoformat(row["end"])
        for i in range(7):
            if first <= start + timedelta(days=i) <= last:
                days.setdefault(row["employee_id"], set()).add(i)
    return {emp_id: sorted(d) for emp_id, d in days.items()}


# ---------- Feriados ----------
def easter(year: int) -> date:
    """Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def national_holidays(year: int) -> Dict[str, str]:
    fixed = {
        "01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho",
        "09-07": "Independência do Brasil", "10-12": "Nossa Senhora Aparecida", "11-02": "Finados",
        "11-15": "Proclamação da República", "11-20": "Dia Nacional de Zumbi e da Consciência Negra",
        "12-25": "Natal",
    }
    days = {f"{year}-{md}": name for md, name in fixed.items()}
    days[(easter(year) - timedelta(days=2)).isoformat()] = "Sexta-feira Santa"
    return days


async def holidays_between(request: Request, first: date, last: date) -> List[Dict[str, Any]]:
    """Feriados nacionais (automáticos) + cadastrados; o cadastro sobrescreve o nacional da mesma data."""
    found: Dict[str, Dict[str, Any]] = {}
    for year in range(first.year, last.year + 1):
        for iso, name in national_holidays(year).items():
            if first.isoformat() <= iso <= last.isoformat():
                found[iso] = {"date": iso, "name": name, "kind": "nacional", "closed": False}
    rows = (await db(request).prepare(
        "SELECT date, name, kind, closed FROM holidays WHERE date >= ? AND date <= ?"
    ).bind(first.isoformat(), last.isoformat()).all()).results
    for r in rows:
        found[r["date"]] = {"date": r["date"], "name": r["name"], "kind": r["kind"], "closed": bool(r["closed"])}
    return sorted(found.values(), key=lambda h: h["date"])


async def week_holidays(request: Request, week: str) -> Dict[str, Dict[str, Any]]:
    start = date.fromisoformat(week)
    items = await holidays_between(request, start, start + timedelta(days=6))
    return {str((date.fromisoformat(h["date"]) - start).days): {k: h[k] for k in ("name", "kind", "closed")} for h in items}


async def get_schedule(request: Request, week: str) -> Schedule:
    schedule = await load_schedule(request, week)
    schedule.vacation_days = await vacation_days_for(request, week)
    schedule.sick_days = await vacation_days_for(request, week, "atestado")
    schedule.holidays = await week_holidays(request, week)
    schedule.closed_days = sorted(int(d) for d, h in schedule.holidays.items() if h["closed"])
    return schedule


def merge_days(*dicts: Dict[str, List[int]]) -> Dict[str, List[int]]:
    out: Dict[str, set] = {}
    for d in dicts:
        for k, v in d.items():
            out.setdefault(k, set()).update(v)
    return {k: sorted(v) for k, v in out.items()}


async def load_schedule(request: Request, week: str) -> Schedule:
    row = await db(request).prepare(
        "SELECT week, mode, off_days, suspension_days, generated_at, sector_modes, absence_days, convocations FROM schedule WHERE week = ?"
    ).bind(week).first()
    if row:
        stored_suspensions = json.loads(row["suspension_days"])
        suspensions = {key: [day for day in days if day >= 0] for key, days in stored_suspensions.items()}
        extras = {key: [-day - 1 for day in days if day < 0] for key, days in stored_suspensions.items()}
        return Schedule(
            week=row["week"], mode=row["mode"], off_days=json.loads(row["off_days"]),
            suspension_days=suspensions, extra_days=extras, generated_at=row["generated_at"],
            sector_modes=json.loads(row["sector_modes"] or "{}"),
            absence_days=json.loads(row["absence_days"] or "{}"),
            convocations=json.loads(row["convocations"] or "{}"),
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
        """INSERT INTO schedule (week, mode, off_days, suspension_days, generated_at, sector_modes, absence_days, convocations)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(week) DO UPDATE SET mode=excluded.mode,
        off_days=excluded.off_days, suspension_days=excluded.suspension_days,
        generated_at=excluded.generated_at, sector_modes=excluded.sector_modes,
        absence_days=excluded.absence_days, convocations=excluded.convocations"""
    ).bind(schedule.week, schedule.mode, json.dumps(schedule.off_days),
           json.dumps(stored_suspensions), schedule.generated_at, json.dumps(schedule.sector_modes),
           json.dumps(schedule.absence_days), json.dumps(schedule.convocations)).run()


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
    if SUNDAY in schedule.closed_days:
        return "F"  # domingo com a loja fechada conta como domingo de folga
    if SUNDAY in schedule.vacation_days.get(emp_id, []) or SUNDAY in schedule.sick_days.get(emp_id, []):
        return "F"
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


def worked_days(schedule: Schedule, emp_id: str, assume_working: bool = False) -> List[bool] | None:
    """Dias trabalhados na semana; None se a pessoa não está na escala.

    assume_working: efetivo ativo que ainda não entrou na escala (setor não gerado, nenhum clique)
    conta como trabalhando todos os dias, para o aviso de dias seguidos não deixar ninguém de fora.
    """
    vacation = set(schedule.vacation_days.get(emp_id, [])) | set(schedule.sick_days.get(emp_id, []))
    closed = set(schedule.closed_days)
    if emp_id not in schedule.off_days and not vacation and not assume_working:
        accepted = {int(d) for d, c in schedule.convocations.get(emp_id, {}).items() if c.get("status") == "accepted"}
        return [day in accepted and day not in closed for day in range(7)] if accepted else None
    # EXTRA é computado como folga
    off = set(schedule.off_days.get(emp_id, [])) | set(schedule.suspension_days.get(emp_id, []))
    off |= set(schedule.absence_days.get(emp_id, [])) | vacation | closed
    return [day not in off for day in range(7)]


def last_real_off(schedule: Schedule, emp_id: str) -> int | None:
    """Último dia de folga (EXTRA conta como folga) na semana; -1 se não folgou."""
    worked = worked_days(schedule, emp_id)
    if worked is None:
        return None
    offs = [day for day in range(7) if not worked[day]]
    return offs[-1] if offs else -1


def in_schedule_by_default(emp: Employee, schedule: Schedule) -> bool:
    """Efetivo ativo, já contratado na semana, numa semana que chegou a ser escalada."""
    if emp.contract == "intermitente" or emp.status not in ("ativo", "suspensao", "falta"):
        return False
    if emp.created_at[:10] > schedule.week:
        return False  # entrou depois do início da semana
    return schedule.generated_at is not None or bool(schedule.off_days)


def streak_violations(previous: Schedule | None, current: Schedule, emp: Employee) -> List[int]:
    """Dias desta semana que passam do 6º dia seguido de trabalho."""
    now = worked_days(current, emp.id, in_schedule_by_default(emp, current))
    if now is None:
        return []
    before = (worked_days(previous, emp.id, in_schedule_by_default(emp, previous))
              if previous else None) or [False] * 7
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
        if emp.status in ("ferias", "inativo"):
            continue
        alert = None if emp.contract == "intermitente" else sunday_alert(
            emp.gender, sunday_of(schedule, emp.id), [sunday_of(h, emp.id) for h in history])
        if alert:
            schedule.cct_alerts[emp.id] = alert
        streak = streak_violations(history[0] if history else None, schedule, emp)
        if streak:
            schedule.streak_alerts[emp.id] = streak
    return schedule


def compute_schedule(employees: List[Employee], movement: Movement, mode: str,
                     rotate: int = 0, previous_days: dict | None = None,
                     sunday_rule: Dict[str, str] | None = None,
                     sector_modes: Dict[str, str] | None = None,
                     vacation: Dict[str, List[int]] | None = None,
                     closed: List[int] | None = None,
                     offs_per_mode: Dict[str, int] | None = None) -> Dict[str, List[int]]:
    shut = set(closed or [])
    max_avg = max(movement.avg) or 1
    weight = [1 + 4 * (value / max_avg) for value in movement.avg]
    peaks = set(movement.peak_days)
    off_sector: Dict[str, List[int]] = {}
    result: Dict[str, List[int]] = {}
    holiday = [e for e in employees if e.status == "ferias"]
    active = [e for e in employees if e.status in ("ativo", "suspensao", "falta") and e.contract != "intermitente"]
    for emp in holiday:
        result[emp.id] = list(range(7))
    ordered = []
    for sector in sorted({e.sector.lower() for e in active}):
        group = sorted([e for e in active if e.sector.lower() == sector], key=lambda e: e.created_at)
        k = rotate % len(group) if group else 0
        ordered.extend(group[k:] + group[:k])
    for emp in ordered:
        sec = off_sector.setdefault(emp.sector.lower(), [0] * 7)
        offs_needed = (offs_per_mode or OFFS_PER_MODE).get((sector_modes or {}).get(emp.sector.lower(), mode), 1)
        # Último dia de folga da semana anterior (6 = domingo, sem restrição se não houver histórico)
        last_day = (previous_days or {}).get(emp.id, SUNDAY)
        rule = (sunday_rule or {}).get(emp.id)
        vac = set((vacation or {}).get(emp.id, []))
        if vac:
            # Semana com férias: os dias de férias contam como descanso
            if len(vac) >= 7:
                result[emp.id] = []
                continue
            rule = None
            offs_needed = max(0, offs_needed - len(vac))
            if offs_needed == 0 and not any(d <= last_day for d in vac):
                offs_needed = 1  # ainda precisa de folga para não passar de 6 dias seguidos
            offs_needed = min(offs_needed, 7 - len(vac))
        if SUNDAY in shut:
            rule = None  # domingo fechado: a regra de domingos já está cumprida
        offs_needed = min(offs_needed, 7 - len(vac) - len(shut))
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
                if pick == offs_needed - 1 and not any(d <= last_day for d in chosen + list(vac) + list(shut)) and day > last_day:
                    value += 1000000 + 1000 * (day - last_day)
                # Regra de domingos da CCT tem prioridade sobre as demais
                if rule == "F" and SUNDAY not in chosen and day != SUNDAY:
                    value += 100000
                if rule == "T" and day == SUNDAY:
                    value += 100000
                return value
            day = min((d for d in range(7) if d not in chosen and d not in vac and d not in shut), key=lambda d: (cost(d), d))
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


async def register_sector(request: Request, name: str) -> str:
    """Nome do setor como está cadastrado; setor novo entra na lista de setores."""
    name = name.strip()
    rows = (await db(request).prepare("SELECT name FROM sectors").all()).results
    for row in rows:
        if row["name"].strip().lower() == name.lower():
            return row["name"]
    await db(request).prepare("INSERT OR IGNORE INTO sectors (id, name, created_at) VALUES (?, ?, ?)").bind(
        str(uuid.uuid4()), name, now_iso()).run()
    return name


@api.post("/employees", response_model=Employee)
async def create_employee(data: EmployeeIn, request: Request):
    data.sector = await register_sector(request, data.sector)
    emp = Employee(**data.model_dump())
    await db(request).prepare(
        "INSERT INTO employees (id, name, role, sector, status, gender, workload, contract, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(emp.id, emp.name, emp.role, emp.sector, emp.status, emp.gender, emp.workload, emp.contract, emp.created_at).run()
    return emp


@api.put("/employees/{emp_id}", response_model=Employee)
async def update_employee(emp_id: str, data: EmployeeIn, request: Request):
    database = db(request)
    existing = await database.prepare("SELECT id, created_at FROM employees WHERE id = ?").bind(emp_id).first()
    if not existing:
        raise HTTPException(404, "Funcionário não encontrado")
    data.sector = await register_sector(request, data.sector)
    await database.prepare(
        "UPDATE employees SET name=?, role=?, sector=?, status=?, gender=?, workload=?, contract=? WHERE id=?"
    ).bind(data.name, data.role, data.sector, data.status, data.gender, data.workload, data.contract, emp_id).run()
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
    await database.prepare("DELETE FROM vacations WHERE employee_id = ?").bind(emp_id).run()
    return {"ok": True}


@api.get("/movement", response_model=Movement)
async def movement_api(request: Request, week: str | None = None):
    return await get_movement(request, week)


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
    key = week_start(data.week) if data.week else "main"
    mov = Movement(avg=averages, samples=counts, peak_days=sorted(peaks),
                   total_records=records, updated_at=now_iso(),
                   week=None if key == "main" else key, source_week=None if key == "main" else key)
    await save_movement(request, mov, key)
    return mov


@api.put("/movement/peaks", response_model=Movement)
async def set_peaks(data: PeaksIn, request: Request):
    # Pico marcado numa semana sem importação própria: vale só para ela (copia o movimento usado)
    key = week_start(data.week) if data.week else "main"
    mov = await get_movement(request, data.week)
    mov.peak_days = sorted({day for day in data.peak_days if 0 <= day <= 6})
    mov.updated_at = now_iso()
    mov.week = None if key == "main" else key
    await save_movement(request, mov, key)
    return mov


@api.get("/workloads", response_model=List[WorkloadOut])
async def workloads_api(request: Request):
    rows = (await db(request).prepare(
        "SELECT id, name, minutes, break_minutes, minutes_5x2, times, times_5x2 FROM workloads ORDER BY created_at"
    ).all()).results
    return [WorkloadOut(id=row["id"], name=row["name"], minutes=json.loads(row["minutes"]),
                        break_minutes=row["break_minutes"], minutes_5x2=row["minutes_5x2"],
                        times=json.loads(row["times"]) if row["times"] else None,
                        times_5x2=json.loads(row["times_5x2"]) if row["times_5x2"] else None) for row in rows]


@api.post("/workloads", response_model=WorkloadOut)
async def create_workload(data: WorkloadIn, request: Request):
    require_admin(request)
    item = WorkloadOut(id=str(uuid.uuid4()), **data.model_dump())
    await db(request).prepare(
        """INSERT INTO workloads (id, name, minutes, break_minutes, minutes_5x2, times, times_5x2, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)"""
    ).bind(item.id, item.name, json.dumps(item.minutes), item.break_minutes, item.minutes_5x2,
           json.dumps(item.times) if item.times else None,
           json.dumps(item.times_5x2) if item.times_5x2 else None, now_iso()).run()
    return item


@api.put("/workloads/{workload_id}", response_model=WorkloadOut)
async def update_workload(workload_id: str, data: WorkloadIn, request: Request):
    require_admin(request)
    database = db(request)
    if not await database.prepare("SELECT id FROM workloads WHERE id = ?").bind(workload_id).first():
        raise HTTPException(404, "Jornada não encontrada")
    item = WorkloadOut(id=workload_id, **data.model_dump())
    await database.prepare(
        """UPDATE workloads SET name=?, minutes=?, break_minutes=?, minutes_5x2=?, times=?, times_5x2=?
        WHERE id=?"""
    ).bind(item.name, json.dumps(item.minutes), item.break_minutes, item.minutes_5x2,
           json.dumps(item.times) if item.times else None,
           json.dumps(item.times_5x2) if item.times_5x2 else None, workload_id).run()
    return item


@api.delete("/workloads/{workload_id}")
async def delete_workload(workload_id: str, request: Request):
    require_admin(request)
    database = db(request)
    await database.prepare("DELETE FROM workloads WHERE id = ?").bind(workload_id).run()
    await database.prepare("UPDATE employees SET workload = NULL WHERE workload = ?").bind(workload_id).run()
    return {"ok": True}


class AdminUnlockIn(BaseModel):
    password: str


@api.post("/admin/unlock")
async def admin_unlock(data: AdminUnlockIn, request: Request):
    admin_password = getattr(request.scope["env"], "FOLGASMART_ADMIN_PASSWORD", None)
    if not admin_password:
        raise HTTPException(503, "Senha do administrador não configurada no Cloudflare (FOLGASMART_ADMIN_PASSWORD).")
    _, signing_key = _secrets(request)
    database = db(request)
    now = int(time.time())
    key = "adm:" + request.headers.get("cf-connecting-ip", "unknown")
    attempt = await database.prepare("SELECT window_started, attempts FROM auth_attempts WHERE ip = ?").bind(key).first()
    window_started = int(attempt["window_started"]) if attempt else now
    attempts = int(attempt["attempts"]) if attempt else 0
    if now - window_started >= LOGIN_WINDOW_SECONDS:
        window_started, attempts = now, 0
    if attempts >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(429, "Muitas tentativas. Aguarde 15 minutos e tente novamente.")
    if not hmac.compare_digest(data.password.strip().encode(), str(admin_password).strip().encode()):
        await database.prepare(
            """INSERT INTO auth_attempts (ip, window_started, attempts) VALUES (?, ?, ?)
            ON CONFLICT(ip) DO UPDATE SET window_started=excluded.window_started, attempts=excluded.attempts"""
        ).bind(key, window_started, attempts + 1).run()
        raise HTTPException(403, "Senha do administrador incorreta.")
    await database.prepare("DELETE FROM auth_attempts WHERE ip = ?").bind(key).run()
    expiry = now + ADMIN_UNLOCK_SECONDS
    payload = _b64encode(json.dumps({"adm": 1, "exp": expiry}, separators=(",", ":")).encode())
    signature = hmac.new(signing_key.encode(), f"adm.{payload}".encode(), hashlib.sha256).digest()
    return {"token": f"{payload}.{_b64encode(signature)}", "expires_at": expiry}


@api.get("/vacations", response_model=List[Vacation])
async def vacations_api(request: Request):
    rows = (await db(request).prepare(
        "SELECT id, employee_id, start, end, kind FROM vacations ORDER BY start"
    ).all()).results
    return [Vacation(id=r["id"], employee_id=r["employee_id"], start=r["start"], end=r["end"],
                     kind=r["kind"] or "ferias") for r in rows]


@api.post("/vacations", response_model=Vacation)
async def create_vacation(data: VacationIn, request: Request):
    try:
        first, last = date.fromisoformat(data.start), date.fromisoformat(data.end)
    except ValueError:
        raise HTTPException(400, "Datas inválidas. Use AAAA-MM-DD.")
    what = "do atestado" if data.kind == "atestado" else "das férias"
    if last < first:
        raise HTTPException(400, f"O fim {what} precisa ser depois do início.")
    if (last - first).days > (180 if data.kind == "atestado" else 60):
        raise HTTPException(400, f"Período {what} longo demais.")
    # Atestado pode ser lançado em dia que já passou; férias no passado só com a senha do administrador
    if data.kind == "ferias" and first < today_br() and not admin_unlocked(request):
        raise HTTPException(423, "Férias com dias que já passaram: desbloqueie com a senha do administrador.")
    if not await db(request).prepare("SELECT id FROM employees WHERE id = ?").bind(data.employee_id).first():
        raise HTTPException(404, "Funcionário não encontrado")
    item = Vacation(id=str(uuid.uuid4()), employee_id=data.employee_id, start=first.isoformat(), end=last.isoformat(),
                    kind=data.kind)
    await db(request).prepare(
        "INSERT INTO vacations (id, employee_id, start, end, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(item.id, item.employee_id, item.start, item.end, item.kind, now_iso()).run()
    return item


@api.delete("/vacations/{vacation_id}")
async def delete_vacation(vacation_id: str, request: Request):
    row = await db(request).prepare("SELECT start, kind FROM vacations WHERE id = ?").bind(vacation_id).first()
    if row and (row["kind"] or "ferias") == "ferias" and date.fromisoformat(row["start"]) < today_br() \
            and not admin_unlocked(request):
        raise HTTPException(423, "Férias com dias que já passaram: desbloqueie com a senha do administrador.")
    await db(request).prepare("DELETE FROM vacations WHERE id = ?").bind(vacation_id).run()
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
        item.sector = await register_sector(request, item.sector)
        emp = Employee(**item.model_dump())
        await db(request).prepare(
            "INSERT INTO employees (id, name, role, sector, status, gender, workload, contract, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(emp.id, emp.name, emp.role, emp.sector, emp.status, emp.gender, emp.workload, emp.contract, emp.created_at).run()
        existing.add(key)
        created += 1
    return {"created": created, "skipped": len(data.employees) - created}


async def list_models(request: Request) -> List[Dict[str, Any]]:
    rows = (await db(request).prepare(
        "SELECT id, name, work_days, weekly_minutes, builtin FROM scale_models ORDER BY builtin DESC, created_at"
    ).all()).results
    return [{"id": r["id"], "name": r["name"], "work_days": int(r["work_days"]),
             "weekly_minutes": int(r["weekly_minutes"]) if r["weekly_minutes"] is not None else None,
             "builtin": bool(r["builtin"])} for r in rows]


async def offs_by_mode(request: Request) -> Dict[str, int]:
    return {m["id"]: max(0, 7 - m["work_days"]) for m in await list_models(request)}


async def ensure_model(request: Request, mode: str) -> str:
    if not await db(request).prepare("SELECT id FROM scale_models WHERE id = ?").bind(mode).first():
        raise HTTPException(400, "Escala não cadastrada.")
    return mode


async def known_sectors(request: Request) -> List[str]:
    names = {r["name"].strip().lower() for r in (await db(request).prepare("SELECT name FROM sectors").all()).results}
    names |= {(r["sector"] or "").strip().lower()
              for r in (await db(request).prepare("SELECT DISTINCT sector FROM employees").all()).results}
    return sorted(n for n in names if n)


async def resolve_modes(request: Request, week: str) -> Dict[str, str]:
    """Escala de cada setor (nome em minúsculas) na semana, pelas datas de início.

    Vale a alteração mais recente que já começou. Uma alteração para todos os setores ("*") substitui
    as de cada setor feitas antes dela; na mesma data, a do setor vale mais que a geral."""
    rows = (await db(request).prepare(
        """SELECT sector, mode, start_week FROM sector_mode_changes WHERE start_week <= ?
        ORDER BY start_week, CASE WHEN sector = '*' THEN 0 ELSE 1 END, created_at"""
    ).bind(week).all()).results
    default, per_sector = "6x1", {}
    for row in rows:
        if row["sector"] == "*":
            default, per_sector = row["mode"], {}
        else:
            per_sector[row["sector"].lower()] = row["mode"]
    sectors = set(await known_sectors(request)) | set(per_sector)
    return {name: per_sector.get(name, default) for name in sorted(sectors)}


def current_week() -> str:
    today = today_br()
    return (today - timedelta(days=today.weekday())).isoformat()


@api.get("/sectors/modes")
async def sector_modes_api(request: Request, week: str | None = None):
    return await resolve_modes(request, week_start(week) if week else current_week())


async def upsert_mode_change(request: Request, sector: str, mode: str, start_week: str) -> None:
    database = db(request)
    await database.prepare("DELETE FROM sector_mode_changes WHERE sector = ? AND start_week = ?").bind(sector, start_week).run()
    await database.prepare(
        "INSERT INTO sector_mode_changes (id, sector, mode, start_week, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(str(uuid.uuid4()), sector, mode, start_week, now_iso()).run()


@api.put("/sectors/mode")
async def set_sector_mode(data: SectorModeIn, request: Request):
    """Escala escolhida ao gerar: vale para o setor a partir da semana gerada."""
    week = week_start(data.week) if data.week else current_week()
    await ensure_model(request, data.mode)
    await upsert_mode_change(request, data.sector.lower(), data.mode, week)
    return await resolve_modes(request, week)


class ModeChangeIn(BaseModel):
    sector: Text  # "*" = todos os setores
    mode: Mode
    start: str  # data de início; vale a partir da segunda-feira dessa semana


@api.get("/sectors/mode-changes")
async def mode_changes_api(request: Request):
    rows = (await db(request).prepare(
        "SELECT id, sector, mode, start_week FROM sector_mode_changes ORDER BY start_week DESC, sector"
    ).all()).results
    return [{"id": r["id"], "sector": r["sector"], "mode": r["mode"], "start_week": r["start_week"]} for r in rows]


@api.post("/sectors/mode-changes")
async def create_mode_change(data: ModeChangeIn, request: Request):
    require_admin(request)
    await ensure_model(request, data.mode)
    week = week_start(data.start)
    if week < current_week():
        raise HTTPException(400, "A data de início precisa ser desta semana em diante. Semanas que já passaram não mudam.")
    sector = "*" if data.sector.strip() == "*" else data.sector.strip().lower()
    await upsert_mode_change(request, sector, data.mode, week)
    return await mode_changes_api(request)


@api.delete("/sectors/mode-changes/{change_id}")
async def delete_mode_change(change_id: str, request: Request):
    require_admin(request)
    row = await db(request).prepare("SELECT start_week FROM sector_mode_changes WHERE id = ?").bind(change_id).first()
    if row and row["start_week"] <= current_week():
        raise HTTPException(400, "Essa escala já está valendo e faz parte do histórico. Para mudar, cadastre uma nova data de início.")
    await db(request).prepare("DELETE FROM sector_mode_changes WHERE id = ?").bind(change_id).run()
    return await mode_changes_api(request)


@api.get("/notices")
async def notices_api(request: Request):
    """Trocas de escala que começam nos próximos 7 dias (aviso na semana anterior)."""
    today = today_br()
    first, last = (today + timedelta(days=1)).isoformat(), (today + timedelta(days=7)).isoformat()
    rows = (await db(request).prepare(
        "SELECT sector, mode, start_week FROM sector_mode_changes WHERE start_week >= ? AND start_week <= ? ORDER BY start_week"
    ).bind(first, last).all()).results
    models = {m["id"]: m for m in await list_models(request)}
    names = {r["name"].strip().lower(): r["name"] for r in (await db(request).prepare("SELECT name FROM sectors").all()).results}
    return [{"start_week": r["start_week"], "sector": "*" if r["sector"] == "*" else names.get(r["sector"], r["sector"]),
             "mode": r["mode"], "model": models.get(r["mode"])} for r in rows]


# ---------- Modelos de escala ----------
class ScaleModelIn(BaseModel):
    name: Text
    work_days: int = Field(ge=1, le=6)
    weekly_minutes: int | None = Field(default=None, ge=60, le=60 * 60)


@api.get("/scale-models")
async def scale_models_api(request: Request):
    return await list_models(request)


@api.post("/scale-models")
async def create_scale_model(data: ScaleModelIn, request: Request):
    require_admin(request)
    if any(m["name"].strip().lower() == data.name.strip().lower() for m in await list_models(request)):
        raise HTTPException(400, f'Já existe uma escala chamada "{data.name.strip()}".')
    await db(request).prepare(
        "INSERT INTO scale_models (id, name, work_days, weekly_minutes, builtin, created_at) VALUES (?, ?, ?, ?, 0, ?)"
    ).bind(str(uuid.uuid4()), data.name.strip(), data.work_days, data.weekly_minutes, now_iso()).run()
    return await list_models(request)


@api.put("/scale-models/{model_id}")
async def update_scale_model(model_id: str, data: ScaleModelIn, request: Request):
    require_admin(request)
    row = await db(request).prepare("SELECT builtin FROM scale_models WHERE id = ?").bind(model_id).first()
    if not row:
        raise HTTPException(404, "Escala não encontrada.")
    if row["builtin"]:
        raise HTTPException(400, "As escalas que vêm no sistema não podem ser alteradas. Cadastre uma nova.")
    await db(request).prepare("UPDATE scale_models SET name=?, work_days=?, weekly_minutes=? WHERE id=?").bind(
        data.name.strip(), data.work_days, data.weekly_minutes, model_id).run()
    return await list_models(request)


@api.delete("/scale-models/{model_id}")
async def delete_scale_model(model_id: str, request: Request):
    require_admin(request)
    database = db(request)
    row = await database.prepare("SELECT builtin FROM scale_models WHERE id = ?").bind(model_id).first()
    if row and row["builtin"]:
        raise HTTPException(400, "As escalas que vêm no sistema não podem ser excluídas.")
    if await database.prepare("SELECT id FROM sector_mode_changes WHERE mode = ? LIMIT 1").bind(model_id).first():
        raise HTTPException(400, "Essa escala está em uso por algum setor. Troque a escala do setor antes de excluir.")
    await database.prepare("DELETE FROM scale_models WHERE id = ?").bind(model_id).run()
    return await list_models(request)


# ---------- Setores ----------
class SectorIn(BaseModel):
    name: Text


@api.get("/sectors")
async def sectors_api(request: Request):
    rows = (await db(request).prepare("SELECT id, name FROM sectors ORDER BY name COLLATE NOCASE").all()).results
    counts: Dict[str, int] = {}
    for e in await list_employees(request):
        if e.status != "inativo":
            key = e.sector.strip().lower()
            counts[key] = counts.get(key, 0) + 1
    return [{"id": r["id"], "name": r["name"], "employees": counts.get(r["name"].strip().lower(), 0)} for r in rows]


@api.post("/sectors")
async def create_sector(data: SectorIn, request: Request):
    require_admin(request)
    name = data.name.strip()
    if any(r["name"].strip().lower() == name.lower()
           for r in (await db(request).prepare("SELECT name FROM sectors").all()).results):
        raise HTTPException(400, f'O setor "{name}" já está cadastrado.')
    await register_sector(request, name)
    return await sectors_api(request)


@api.put("/sectors/{sector_id}")
async def rename_sector(sector_id: str, data: SectorIn, request: Request):
    require_admin(request)
    database = db(request)
    row = await database.prepare("SELECT name FROM sectors WHERE id = ?").bind(sector_id).first()
    if not row:
        raise HTTPException(404, "Setor não encontrado.")
    old, new = row["name"].strip(), data.name.strip()
    if old.lower() != new.lower() and any(
            r["name"].strip().lower() == new.lower()
            for r in (await database.prepare("SELECT name FROM sectors").all()).results):
        raise HTTPException(400, f'O setor "{new}" já está cadastrado.')
    await database.prepare("UPDATE sectors SET name = ? WHERE id = ?").bind(new, sector_id).run()
    await database.prepare("UPDATE employees SET sector = ? WHERE lower(trim(sector)) = ?").bind(new, old.lower()).run()
    await database.prepare("UPDATE sector_mode_changes SET sector = ? WHERE sector = ?").bind(new.lower(), old.lower()).run()
    # Semanas já geradas guardam a escala de cada setor pelo nome: acompanha o nome novo
    rows = (await database.prepare("SELECT week, sector_modes FROM schedule WHERE sector_modes LIKE ?").bind(
        f"%{old}%").all()).results
    for row in rows:
        modes = json.loads(row["sector_modes"] or "{}")
        renamed = {(new if k.strip().lower() == old.lower() else k): v for k, v in modes.items()}
        if renamed != modes:
            await database.prepare("UPDATE schedule SET sector_modes = ? WHERE week = ?").bind(
                json.dumps(renamed), row["week"]).run()
    return await sectors_api(request)


@api.delete("/sectors/{sector_id}")
async def delete_sector(sector_id: str, request: Request):
    require_admin(request)
    database = db(request)
    row = await database.prepare("SELECT name FROM sectors WHERE id = ?").bind(sector_id).first()
    if not row:
        return await sectors_api(request)
    if await database.prepare("SELECT id FROM employees WHERE lower(trim(sector)) = ? LIMIT 1").bind(
            row["name"].strip().lower()).first():
        raise HTTPException(400, "Há funcionários neste setor. Mude o setor deles antes de excluir.")
    await database.prepare("DELETE FROM sectors WHERE id = ?").bind(sector_id).run()
    await database.prepare("DELETE FROM sector_mode_changes WHERE sector = ?").bind(row["name"].strip().lower()).run()
    return await sectors_api(request)


@api.get("/schedule", response_model=Schedule)
async def schedule_api(week: str, request: Request):
    return await with_alerts(request, await get_schedule(request, week_start(week)))


@api.post("/schedule/generate", response_model=Schedule)
async def generate(data: GenerateIn, request: Request):
    week = week_start(data.week)
    if is_past(week, 0) and not admin_unlocked(request):
        raise HTTPException(423, "Esta semana já começou e os dias passados estão bloqueados. "
                                 "Para gerar de novo, desbloqueie com a senha do administrador.")
    employees = await list_employees(request)
    mov = await get_movement(request, week)
    week_date = date.fromisoformat(week)
    previous_week = (week_date - timedelta(days=7)).isoformat()
    rotate = week_date.isocalendar()[1]
    history = await sunday_history(request, week, 3)
    previous_days = {}
    for emp in employees:
        last = last_real_off(history[0], emp.id)
        if last is not None:
            previous_days[emp.id] = last
    sector_key = (data.sector or "").strip().lower()
    target = [e for e in employees if not sector_key or e.sector.lower() == sector_key]
    if not target:
        raise HTTPException(400, "Nenhum funcionário nesse setor.")
    sector_modes = await resolve_modes(request, week)
    snapshot = {}
    for emp in target:
        snapshot[emp.sector] = sector_modes.get(emp.sector.lower(), "6x1")
    sunday_rule = {}
    for emp in target:
        if emp.status in ("ferias", "inativo") or not emp.gender or emp.contract == "intermitente":
            continue
        same = sorted([e for e in employees if e.sector.lower() == emp.sector.lower() and e.gender == emp.gender
                       and e.status not in ("ferias", "inativo") and e.contract != "intermitente"],
                      key=lambda e: e.created_at)
        plan = sunday_plan(emp.gender, [sunday_of(h, emp.id) for h in history], rotate + same.index(emp))
        if plan:
            sunday_rule[emp.id] = plan
    vacation = await vacation_days_for(request, week)
    sick = await vacation_days_for(request, week, "atestado")
    off_days = compute_schedule(target, mov, data.mode, rotate, previous_days, sunday_rule,
                                {k.lower(): v for k, v in snapshot.items()}, merge_days(vacation, sick),
                                [int(d) for d, h in (await week_holidays(request, week)).items() if h["closed"]],
                                await offs_by_mode(request))
    if sector_key:
        # Refaz só o setor escolhido: folgas, EXTRA e suspensões dos outros setores ficam como estão
        sched = await get_schedule(request, week)
        ids = {e.id for e in target}
        sched.off_days = {k: v for k, v in sched.off_days.items() if k not in ids} | off_days
        sched.suspension_days = {k: v for k, v in sched.suspension_days.items() if k not in ids}
        sched.absence_days = {k: v for k, v in sched.absence_days.items() if k not in ids}
        sched.extra_days = {k: v for k, v in sched.extra_days.items() if k not in ids}
        sched.sector_modes = {k: v for k, v in sched.sector_modes.items() if k.lower() != sector_key} | snapshot
        sched.generated_at = now_iso()
    else:
        previous = await get_schedule(request, week)
        sched = Schedule(week=week, mode=data.mode, generated_at=now_iso(), off_days=off_days, sector_modes=snapshot,
                         convocations=previous.convocations)
    sched.vacation_days = vacation
    sched.sick_days = sick
    sched.holidays = await week_holidays(request, week)
    sched.closed_days = sorted(int(d) for d, h in sched.holidays.items() if h["closed"])
    await save_schedule(request, sched)
    return await with_alerts(request, sched, employees, history[:2])


@api.put("/schedule/cell", response_model=Schedule)
async def toggle_cell(data: CellToggle, request: Request):
    employee = await db(request).prepare(
        "SELECT status, role, contract FROM employees WHERE id = ?"
    ).bind(data.employee_id).first()
    if not employee:
        raise HTTPException(404, "Funcionário não encontrado")
    sched = await get_schedule(request, week_start(data.week))
    contract = employee["contract"] or ("intermitente" if "intermitente" in (employee["role"] or "").lower() else "efetivo")
    if data.day in sched.closed_days:
        raise HTTPException(400, "Feriado com a loja fechada: ninguém trabalha nesse dia.")
    if is_past(sched.week, data.day) and not admin_unlocked(request):
        # Dia passado: só lança ou retira FALTA de quem estava escalado para trabalhar
        off = sched.off_days.get(data.employee_id, [])
        extra = sched.extra_days.get(data.employee_id, [])
        absence = list(sched.absence_days.get(data.employee_id, []))
        resting = (data.day in off and data.day not in extra) or data.day in sched.suspension_days.get(data.employee_id, []) \
            or data.day in sched.vacation_days.get(data.employee_id, []) or data.day in sched.sick_days.get(data.employee_id, [])
        if contract == "intermitente":
            resting = sched.convocations.get(data.employee_id, {}).get(str(data.day), {}).get("status") != "accepted"
        if data.extra or (resting and data.day not in absence):
            raise HTTPException(423, LOCKED_MSG)
        if data.day in absence:
            absence.remove(data.day)
        else:
            absence.append(data.day)
        sched.absence_days[data.employee_id] = sorted(absence)
        await save_schedule(request, sched)
        return await with_alerts(request, sched)
    if contract == "intermitente":
        if data.extra:
            raise HTTPException(400, "Intermitente não tem folga para marcar EXTRA.")
        days = dict(sched.convocations.get(data.employee_id, {}))
        key = str(data.day)
        current = days.get(key, {}).get("status")
        if current is None:
            days[key] = {"status": "pending", "at": datetime.now(timezone.utc).date().isoformat()}
        elif current == "pending":
            days[key] = {**days[key], "status": "accepted"}
        elif current == "accepted":
            days[key] = {**days[key], "status": "declined"}
        else:
            days.pop(key)
        sched.convocations[data.employee_id] = days
        await save_schedule(request, sched)
        return await with_alerts(request, sched)
    off = list(sched.off_days.get(data.employee_id, []))
    suspension = list(sched.suspension_days.get(data.employee_id, []))
    absence = list(sched.absence_days.get(data.employee_id, []))
    extra = list(sched.extra_days.get(data.employee_id, []))

    if data.extra:
        if employee["status"] == "ferias":
            raise HTTPException(400, "A marcação EXTRA não pode ser usada para funcionário de férias.")
        if data.day not in off:
            raise HTTPException(400, "EXTRA só pode ser marcado em um dia de folga.")
        if data.day in extra:
            extra.remove(data.day)
        else:
            extra.append(data.day)
    elif data.day in extra:
        extra.remove(data.day)
    # Ciclo para todos: TRAB. -> FOLGA -> SUSP. -> FALTA -> TRAB.
    elif data.day in off:
        off.remove(data.day)
        suspension.append(data.day)
    elif data.day in suspension:
        suspension.remove(data.day)
        absence.append(data.day)
    elif data.day in absence:
        absence.remove(data.day)
    else:
        off.append(data.day)

    sched.off_days[data.employee_id] = sorted(off)
    sched.suspension_days[data.employee_id] = sorted(suspension)
    sched.absence_days[data.employee_id] = sorted(absence)
    sched.extra_days[data.employee_id] = sorted(extra)
    await save_schedule(request, sched)
    return await with_alerts(request, sched)



@api.get("/hourly", response_model=List[Hourly])
async def hourly_api(request: Request, week: str | None = None):
    """Relatório por hora de cada dia da semana. Dia sem relatório nesta semana usa o da última
    semana anterior que tiver (o campo week diz de qual semana veio; None = importação antiga)."""
    database = db(request)
    picked: Dict[int, Hourly] = {}
    if week:
        rows = (await database.prepare(
            "SELECT week, day, label, hours, updated_at FROM hourly_week WHERE week <= ? ORDER BY week DESC"
        ).bind(week_start(week)).all()).results
        for row in rows:
            if row["day"] not in picked:
                picked[row["day"]] = Hourly(day=row["day"], label=row["label"] or "", hours=json.loads(row["hours"]),
                                            updated_at=row["updated_at"], week=row["week"])
    rows = (await database.prepare(
        "SELECT day, label, hours, updated_at FROM hourly_movement ORDER BY day"
    ).all()).results
    for row in rows:
        if row["day"] not in picked:
            picked[row["day"]] = Hourly(day=row["day"], label=row["label"] or "", hours=json.loads(row["hours"]),
                                        updated_at=row["updated_at"])
    return [picked[d] for d in sorted(picked)]


@api.put("/hourly", response_model=Hourly)
async def save_hourly(data: HourlyIn, request: Request):
    hours = sorted({h.hour: h for h in data.hours}.values(), key=lambda h: h.hour)
    week = week_start(data.week) if data.week else None
    item = Hourly(day=data.day, label=data.label.strip()[:120], hours=hours, updated_at=now_iso(), week=week)
    payload = json.dumps([h.model_dump() for h in item.hours])
    if week:
        await db(request).prepare(
            """INSERT INTO hourly_week (week, day, label, hours, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(week, day) DO UPDATE SET label=excluded.label, hours=excluded.hours,
            updated_at=excluded.updated_at"""
        ).bind(week, item.day, item.label, payload, item.updated_at).run()
    else:
        await db(request).prepare(
            """INSERT INTO hourly_movement (day, label, hours, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(day) DO UPDATE SET label=excluded.label, hours=excluded.hours,
            updated_at=excluded.updated_at"""
        ).bind(item.day, item.label, payload, item.updated_at).run()
    return item


@api.delete("/hourly/{day}")
async def delete_hourly(day: int, request: Request, week: str | None = None):
    if week:
        await db(request).prepare("DELETE FROM hourly_week WHERE week = ? AND day = ?").bind(week_start(week), day).run()
    else:
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


class HolidayIn(BaseModel):
    date: str
    name: Text
    kind: Literal["nacional", "estadual", "municipal"] = "municipal"
    closed: bool = False


@api.get("/holidays")
async def holidays_api(year: int, request: Request):
    return await holidays_between(request, date(year, 1, 1), date(year, 12, 31))


@api.put("/holidays")
async def set_holiday(data: HolidayIn, request: Request):
    require_admin(request)
    try:
        day = date.fromisoformat(data.date)
    except ValueError:
        raise HTTPException(400, "Data inválida. Use AAAA-MM-DD.")
    if day < today_br() and not admin_unlocked(request):
        raise HTTPException(423, "Feriado em data que já passou: desbloqueie com a senha do administrador.")
    national = national_holidays(day.year).get(day.isoformat())
    kind, name = ("nacional", national) if national else (data.kind, data.name.strip())
    await db(request).prepare(
        """INSERT INTO holidays (date, name, kind, closed) VALUES (?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET name=excluded.name, kind=excluded.kind, closed=excluded.closed"""
    ).bind(day.isoformat(), name, kind, 1 if data.closed else 0).run()
    return {"date": day.isoformat(), "name": name, "kind": kind, "closed": data.closed}


@api.delete("/holidays/{holiday_date}")
async def delete_holiday(holiday_date: str, request: Request):
    """Remove um feriado cadastrado; um nacional volta ao padrão (loja aberta)."""
    require_admin(request)
    try:
        day = date.fromisoformat(holiday_date)
    except ValueError:
        raise HTTPException(400, "Data inválida.")
    if day < today_br() and not admin_unlocked(request):
        raise HTTPException(423, "Feriado em data que já passou: desbloqueie com a senha do administrador.")
    await db(request).prepare("DELETE FROM holidays WHERE date = ?").bind(day.isoformat()).run()
    return {"ok": True}


# ---------- Caixas (checkouts) e o caixa de cada operadora por dia ----------
class CheckoutIn(BaseModel):
    name: Text


class Checkout(CheckoutIn):
    id: str


STAFF_BOARDS = ("@pack", "@desk")


class CheckoutAssignIn(BaseModel):
    week: str
    day: int = Field(ge=0, le=6)
    employee_id: str
    checkout_id: str | None = None


@api.get("/checkouts", response_model=List[Checkout])
async def checkouts_api(request: Request):
    rows = (await db(request).prepare("SELECT id, name FROM checkouts ORDER BY created_at").all()).results
    return [Checkout(id=r["id"], name=r["name"]) for r in rows]


@api.post("/checkouts", response_model=Checkout)
async def create_checkout(data: CheckoutIn, request: Request):
    name = data.name.strip()
    existing = (await db(request).prepare("SELECT name FROM checkouts").all()).results
    if any(r["name"].strip().lower() == name.lower() for r in existing):
        raise HTTPException(400, f'Já existe um caixa chamado "{name}".')
    item = Checkout(id=str(uuid.uuid4()), name=name)
    await db(request).prepare(
        "INSERT INTO checkouts (id, name, created_at) VALUES (?, ?, ?)"
    ).bind(item.id, item.name, now_iso()).run()
    return item


@api.delete("/checkouts/{checkout_id}")
async def delete_checkout(checkout_id: str, request: Request):
    await db(request).prepare("DELETE FROM checkouts WHERE id = ?").bind(checkout_id).run()
    return {"ok": True}


@api.get("/checkouts/assign/week")
async def checkout_assign_week(week: str, request: Request) -> Dict[str, Dict[str, str]]:
    """Caixa de cada operadora por dia: {"dia": {funcionário: caixa}}."""
    rows = (await db(request).prepare(
        "SELECT day, data FROM checkout_assign WHERE week = ?"
    ).bind(week_start(week)).all()).results
    return {str(r["day"]): json.loads(r["data"]) for r in rows}


@api.put("/checkouts/assign")
async def set_checkout_assign(data: CheckoutAssignIn, request: Request) -> Dict[str, str]:
    week = week_start(data.week)
    ensure_unlocked(request, week, data.day)
    database = db(request)
    row = await database.prepare(
        "SELECT data FROM checkout_assign WHERE week = ? AND day = ?"
    ).bind(week, data.day).first()
    current = json.loads(row["data"]) if row else {}
    if data.checkout_id:
        # "@pack" (Pacoteiros) e "@desk" (Fiscal e Recepcionista): quadros fixos, sem caixa cadastrado
        if data.checkout_id not in STAFF_BOARDS and \
                not await database.prepare("SELECT id FROM checkouts WHERE id = ?").bind(data.checkout_id).first():
            raise HTTPException(404, "Caixa não encontrado")
        current[data.employee_id] = data.checkout_id
    else:
        current.pop(data.employee_id, None)
    await database.prepare(
        """INSERT INTO checkout_assign (week, day, data) VALUES (?, ?, ?)
        ON CONFLICT(week, day) DO UPDATE SET data=excluded.data"""
    ).bind(week, data.day, json.dumps(current)).run()
    return current


@api.get("/shifts/week")
async def week_shifts_api(week: str, request: Request) -> Dict[str, Dict[str, List[str]]]:
    """Turnos ajustados de todos os dias da semana: {"dia": {funcionário: horários}}."""
    rows = (await db(request).prepare(
        "SELECT day, data FROM shifts WHERE week = ?"
    ).bind(week_start(week)).all()).results
    return {str(row["day"]): json.loads(row["data"]) for row in rows}


@api.put("/shifts", response_model=DayShifts)
async def set_shift(data: ShiftIn, request: Request):
    week = week_start(data.week)
    ensure_unlocked(request, week, data.day)
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

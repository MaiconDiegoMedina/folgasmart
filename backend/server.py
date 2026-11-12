from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import sqlite3
import json
import os
import csv
import io
import logging
from pathlib import Path
import re
from pydantic import BaseModel, Field, StringConstraints
from typing import List, Dict, Literal, Annotated
import uuid
from datetime import date, datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent

# Ajuste dinâmico para o PyInstaller encontrar a pasta temporária _MEIPASS
import sys
if hasattr(sys, '_MEIPASS'):
    BASE_PATH = Path(sys._MEIPASS)
else:
    BASE_PATH = ROOT_DIR

# Carrega o .env usando o caminho correto
load_dotenv(ROOT_DIR / '.env')

# Define a variável global do banco SQLite
DB_PATH = ROOT_DIR / "folgasmart.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# Inicializa as tabelas locais do SQLite automaticamente
with get_db() as conn:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS employees (
            id TEXT PRIMARY KEY, 
            name TEXT, 
            role TEXT, 
            sector TEXT, 
            status TEXT, 
            created_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS movement (
            key TEXT PRIMARY KEY, 
            avg TEXT, 
            samples TEXT, 
            peak_days TEXT, 
            total_records INTEGER, 
            updated_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schedule (
            week TEXT PRIMARY KEY, 
            mode TEXT, 
            off_days TEXT, 
            suspension_days TEXT, 
            generated_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS hourly_movement (
            day INTEGER PRIMARY KEY,
            label TEXT,
            hours TEXT,
            updated_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS shifts (
            week TEXT,
            day INTEGER,
            data TEXT,
            PRIMARY KEY (week, day)
        )
    """)

app = FastAPI()

# Configuração de CORS para permitir acesso local e externo (celular/tablet)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")

Mode = Literal["6x1", "5x2"]
OFFS_PER_MODE = {"6x1": 1, "5x2": 2}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Status = Literal["ativo", "ferias", "suspensao"]

class EmployeeIn(BaseModel):
    name: Text
    role: Text
    sector: Text
    status: Status = "ativo"

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
    week: str
    mode: Mode = "6x1"
    off_days: Dict[str, List[int]] = Field(default_factory=dict)
    suspension_days: Dict[str, List[int]] = Field(default_factory=dict)
    generated_at: str | None = None

class GenerateIn(BaseModel):
    mode: Mode
    week: str

class CellToggle(BaseModel):
    employee_id: str
    day: int = Field(ge=0, le=6)
    week: str

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
        d = date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(400, "Semana inválida. Use AAAA-MM-DD")
    return (d - timedelta(days=d.weekday())).isoformat()

# --- FUNÇÕES AUXILIARES DE BANCO DE DADOS (SQLITE) ---

def db_get_movement() -> Movement:
    with get_db() as conn:
        row = conn.execute("SELECT avg, samples, peak_days, total_records, updated_at FROM movement WHERE key = 'main'").fetchone()
        if row:
            return Movement(
                avg=json.loads(row["avg"]),
                samples=json.loads(row["samples"]),
                peak_days=json.loads(row["peak_days"]),
                total_records=row["total_records"],
                updated_at=row["updated_at"]
            )
        return Movement()

def db_save_movement(mov: Movement):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO movement (key, avg, samples, peak_days, total_records, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("main", json.dumps(mov.avg), json.dumps(mov.samples), json.dumps(mov.peak_days), mov.total_records, mov.updated_at)
        )

def db_get_schedule(week: str) -> Schedule:
    with get_db() as conn:
        row = conn.execute("SELECT week, mode, off_days, suspension_days, generated_at FROM schedule WHERE week = ?", (week,)).fetchone()
        if row:
            return Schedule(
                week=row["week"],
                mode=row["mode"],
                off_days=json.loads(row["off_days"]),
                suspension_days=json.loads(row["suspension_days"]),
                generated_at=row["generated_at"]
            )
        last = conn.execute("SELECT mode FROM schedule WHERE generated_at IS NOT NULL ORDER BY generated_at DESC LIMIT 1").fetchone()
        return Schedule(week=week, mode=last["mode"] if last else "6x1")

def db_save_schedule(sched: Schedule):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO schedule (week, mode, off_days, suspension_days, generated_at) VALUES (?, ?, ?, ?, ?)",
            (sched.week, sched.mode, json.dumps(sched.off_days), json.dumps(sched.suspension_days), sched.generated_at)
        )

def db_list_employees() -> List[Employee]:
    with get_db() as conn:
        rows = conn.execute("SELECT id, name, role, sector, status, created_at FROM employees ORDER BY created_at ASC").fetchall()
        return [Employee(id=r["id"], name=r["name"], role=r["role"], sector=r["sector"], status=r["status"], created_at=r["created_at"]) for r in rows]

def parse_date(raw: str):
    raw = raw.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None

def parse_number(raw: str):
    raw = raw.strip()
    if "," in raw or re.fullmatch(r"\d{1,3}(\.\d{3})+", raw):
        raw = raw.replace(".", "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None

# --- ALGORITMO DE DISTRIBUIÇÃO DAS FOLGAS E REGRAS ---

def compute_schedule(employees: List[Employee], movement: Movement, mode: str, rotate: int = 0, folgas_passadas: dict = None) -> Dict[str, List[int]]:
    offs_needed = OFFS_PER_MODE[mode]
    max_avg = max(movement.avg) or 1
    weight = [1 + 4 * (a / max_avg) for a in movement.avg]
    peaks = set(movement.peak_days)
    off_global = [0] * 7
    off_sector: Dict[str, List[int]] = {}
    result: Dict[str, List[int]] = {}
    ordered: List[Employee] = []
    
    ferias_employees = [e for e in employees if getattr(e, 'status', 'ativo') == 'ferias']
    active_employees = [e for e in employees if getattr(e, 'status', 'ativo') in ['ativo', 'suspensao']]
    
    for emp in ferias_employees:
        result[emp.id] = [0, 1, 2, 3, 4, 5, 6]

    for sector in sorted({e.sector.lower() for e in active_employees}):
        group = sorted([e for e in active_employees if e.sector.lower() == sector], key=lambda e: e.created_at)
        k = rotate % len(group) if len(group) > 0 else 0
        ordered += group[k:] + group[:k]
        
    for emp in ordered:
        sec = off_sector.setdefault(emp.sector.lower(), [0] * 7)
        chosen: List[int] = []
        
        if folgas_passadas and emp.id in folgas_passadas:
            folga_semana_passada = folgas_passadas[emp.id]
        else:
            group_sector = [e for e in active_employees if e.sector.lower() == emp.sector.lower()]
            idx_in_group = group_sector.index(emp) if emp in group_sector else 0
            k_last_week = (rotate - 1) % len(group_sector) if len(group_sector) > 0 else 0
            folga_semana_passada = (idx_in_group - k_last_week) % 7
        
        for _ in range(offs_needed):
            def cost(d):
                c = (off_global[d] + 1) * weight[d] + sec[d] * 6
                if d in peaks:
                    c += 1000
                    
                if mode == "6x1":
                    dias_consecutivos = (d + 7) - folga_semana_passada
                    if dias_consecutivos > 6:
                        c += 5000
                return c
                
            day = min((d for d in range(7) if d not in chosen), key=lambda d: (cost(d), d))
            chosen.append(day)
            off_global[day] += 1
            sec[day] += 1
        result[emp.id] = sorted(chosen)
    return result

# --- ROTAS DA API ---

@api.get("/")
def root():
    return {"message": "FolgaSmart API (SQLite Ativo)"}

@api.get("/employees", response_model=List[Employee])
def get_employees():
    return db_list_employees()

@api.post("/employees", response_model=Employee)
def create_employee(data: EmployeeIn):
    emp = Employee(**data.model_dump())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO employees (id, name, role, sector, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (emp.id, emp.name, emp.role, emp.sector, emp.status, emp.created_at)
        )
    return emp

@api.put("/employees/{emp_id}", response_model=Employee)
def update_employee(emp_id: str, data: EmployeeIn):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE employees SET name = ?, role = ?, sector = ?, status = ? WHERE id = ?",
            (data.name, data.role, data.sector, data.status, emp_id)
        )
        if cursor.rowcount == 0:
            raise HTTPException(404, "Funcionário não encontrado")
        row = conn.execute("SELECT id, name, role, sector, status, created_at FROM employees WHERE id = ?", (emp_id,)).fetchone()
        return Employee(id=row["id"], name=row["name"], role=row["role"], sector=row["sector"], status=row["status"], created_at=row["created_at"])

@api.delete("/employees/{emp_id}")
def delete_employee(emp_id: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM employees WHERE id = ?", (emp_id,))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Funcionário não encontrado")
        
        schedules = conn.execute("SELECT week, off_days, suspension_days FROM schedule").fetchall()
        for s in schedules:
            offs = json.loads(s["off_days"])
            susp = json.loads(s["suspension_days"])
            offs.pop(emp_id, None)
            susp.pop(emp_id, None)
            conn.execute("UPDATE schedule SET off_days = ?, suspension_days = ? WHERE week = ?", (json.dumps(offs), json.dumps(susp), s["week"]))
    return {"ok": True}

@api.get("/movement", response_model=Movement)
def get_movement_api():
    return db_get_movement()

@api.post("/movement/import", response_model=Movement)
def import_movement(data: CsvImport):
    text = data.csv.lstrip("\ufeff")
    delimiter = ";" if text.count(";") > text.count(",") else ","
    totals, counts, records = [0.0] * 7, [0] * 7, 0
    for row in csv.reader(io.StringIO(text), delimiter=delimiter):
        if len(row) < 2:
            continue
        d, value = parse_date(row[0]), parse_number(row[1])
        if d is None or value is None:
            continue
        wd = d.weekday()
        totals[wd] += value
        counts[wd] += 1
        records += 1
    if records == 0:
        raise HTTPException(400, "Nenhum registro válido encontrado.")
    avg = [round(totals[i] / counts[i], 1) if counts[i] else 0.0 for i in range(7)]
    mean = sum(avg) / 7
    peaks = sorted([i for i in range(7) if avg[i] >= mean * 1.15], key=lambda i: -avg[i])[:3]
    if not peaks:
        peaks = [max(range(7), key=lambda i: avg[i])]
    mov = Movement(avg=avg, samples=counts, peak_days=sorted(peaks), total_records=records, updated_at=now_iso())
    db_save_movement(mov)
    return mov

@api.put("/movement/peaks", response_model=Movement)
def set_peaks(data: PeaksIn):
    mov = db_get_movement()
    mov.peak_days = sorted({d for d in data.peak_days if 0 <= d <= 6})
    mov.updated_at = now_iso()
    db_save_movement(mov)
    return mov

@api.get("/schedule", response_model=Schedule)
def get_schedule_api(week: str):
    return db_get_schedule(week_start(week))

@api.post("/schedule/generate", response_model=Schedule)
def generate(data: GenerateIn):
    week = week_start(data.week)
    employees = db_list_employees()
    mov = db_get_movement()
    rotate = date.fromisoformat(week).isocalendar()[1]
    
    data_semana_atual = date.fromisoformat(week)
    semana_anterior = (data_semana_atual - timedelta(days=7)).isoformat()
    
    folgas_passadas = {}
    with get_db() as conn:
        row_ant = conn.execute("SELECT off_days FROM schedule WHERE week = ?", (semana_anterior,)).fetchone()
        if row_ant:
            off_days_ant = json.loads(row_ant["off_days"])
            for emp_id, dias_folga in off_days_ant.items():
                if dias_folga:
                    folgas_passadas[emp_id] = dias_folga[-1]

    sched = Schedule(
        week=week, 
        mode=data.mode, 
        generated_at=now_iso(),
        off_days=compute_schedule(employees, mov, data.mode, rotate, folgas_passadas),
        suspension_days={}
    )
    db_save_schedule(sched)
    return sched

@api.put("/schedule/cell", response_model=Schedule)
def toggle_cell(data: CellToggle):
    with get_db() as conn:
        emp = conn.execute("SELECT status FROM employees WHERE id = ?", (data.employee_id,)).fetchone()
    if not emp:
        raise HTTPException(404, "Funcionário não encontrado")
        
    sched = db_get_schedule(week_start(data.week))
    off_days = list(sched.off_days.get(data.employee_id, []))
    susp_days = list(sched.suspension_days.get(data.employee_id, []))
    status = emp["status"]
    
    if status == "suspensao":
        if data.day not in off_days and data.day not in susp_days:
            off_days.append(data.day)
        elif data.day in off_days:
            off_days.remove(data.day)
            susp_days.append(data.day)
        else:
            susp_days.remove(data.day)
    else:
        if data.day in off_days:
            off_days.remove(data.day)
        else:
            if data.day in susp_days:
                susp_days.remove(data.day)
            off_days.append(data.day)
            
    sched.off_days[data.employee_id] = sorted(off_days)
    sched.suspension_days[data.employee_id] = sorted(susp_days)
    
    db_save_schedule(sched)
    return sched

@api.get("/hourly", response_model=List[Hourly])
def get_hourly():
    with get_db() as conn:
        rows = conn.execute("SELECT day, label, hours, updated_at FROM hourly_movement ORDER BY day").fetchall()
    return [Hourly(day=r["day"], label=r["label"] or "", hours=json.loads(r["hours"]), updated_at=r["updated_at"]) for r in rows]

@api.put("/hourly", response_model=Hourly)
def save_hourly(data: HourlyIn):
    hours = sorted({h.hour: h for h in data.hours}.values(), key=lambda h: h.hour)
    item = Hourly(day=data.day, label=data.label.strip()[:120], hours=hours, updated_at=now_iso())
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO hourly_movement (day, label, hours, updated_at) VALUES (?, ?, ?, ?)",
            (item.day, item.label, json.dumps([h.model_dump() for h in item.hours]), item.updated_at)
        )
    return item

@api.delete("/hourly/{day}")
def delete_hourly(day: int):
    with get_db() as conn:
        conn.execute("DELETE FROM hourly_movement WHERE day = ?", (day,))
    return {"ok": True}

def db_get_shifts(week: str, day: int) -> DayShifts:
    with get_db() as conn:
        row = conn.execute("SELECT data FROM shifts WHERE week = ? AND day = ?", (week, day)).fetchone()
    return DayShifts(week=week, day=day, shifts=json.loads(row["data"]) if row else {})

@api.get("/shifts", response_model=DayShifts)
def get_shifts(week: str, day: int):
    if not 0 <= day <= 6:
        raise HTTPException(400, "Dia inválido")
    return db_get_shifts(week_start(week), day)

@api.put("/shifts", response_model=DayShifts)
def set_shift(data: ShiftIn):
    week = week_start(data.week)
    current = db_get_shifts(week, data.day)
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
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO shifts (week, day, data) VALUES (?, ?, ?)",
            (week, data.day, json.dumps(current.shifts))
        )
    return current

app.include_router(api)

# Montagem segura da interface React integrada
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory=str(BASE_PATH / "static"), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_config=None)

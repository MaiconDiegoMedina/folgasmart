from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import csv
import io
import logging
from pathlib import Path
import re
from pydantic import BaseModel, Field, StringConstraints
from typing import List, Dict, Literal, Annotated
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]

app = FastAPI()
api = APIRouter(prefix="/api")

Mode = Literal["6x1", "5x2"]
OFFS_PER_MODE = {"6x1": 1, "5x2": 2}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class EmployeeIn(BaseModel):
    name: Text
    role: Text
    sector: Text


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
    mode: Mode = "6x1"
    off_days: Dict[str, List[int]] = Field(default_factory=dict)
    generated_at: str | None = None


class GenerateIn(BaseModel):
    mode: Mode


class CellToggle(BaseModel):
    employee_id: str
    day: int = Field(ge=0, le=6)


async def get_movement() -> Movement:
    doc = await db.movement.find_one({"_key": "main"}, {"_id": 0, "_key": 0})
    return Movement(**doc) if doc else Movement()


async def get_schedule() -> Schedule:
    doc = await db.schedule.find_one({"_key": "main"}, {"_id": 0, "_key": 0})
    return Schedule(**doc) if doc else Schedule()


async def save(collection, model: BaseModel):
    await collection.replace_one({"_key": "main"}, {"_key": "main", **model.model_dump()}, upsert=True)


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


def compute_schedule(employees: List[Employee], movement: Movement, mode: str) -> Dict[str, List[int]]:
    offs_needed = OFFS_PER_MODE[mode]
    max_avg = max(movement.avg) or 1
    weight = [1 + 4 * (a / max_avg) for a in movement.avg]
    peaks = set(movement.peak_days)
    off_global = [0] * 7
    off_sector: Dict[str, List[int]] = {}
    result: Dict[str, List[int]] = {}
    for emp in sorted(employees, key=lambda e: (e.sector.lower(), e.created_at)):
        sec = off_sector.setdefault(emp.sector.lower(), [0] * 7)
        chosen: List[int] = []
        for _ in range(offs_needed):
            def cost(d):
                c = (off_global[d] + 1) * weight[d] + sec[d] * 6
                if d in peaks:
                    c += 1000
                return c
            day = min((d for d in range(7) if d not in chosen), key=lambda d: (cost(d), d))
            chosen.append(day)
            off_global[day] += 1
            sec[day] += 1
        result[emp.id] = sorted(chosen)
    return result


async def list_employees() -> List[Employee]:
    docs = await db.employees.find({}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    return [Employee(**d) for d in docs]


@api.get("/")
async def root():
    return {"message": "FolgaSmart API"}


@api.get("/employees", response_model=List[Employee])
async def get_employees():
    return await list_employees()


@api.post("/employees", response_model=Employee)
async def create_employee(data: EmployeeIn):
    emp = Employee(**data.model_dump())
    await db.employees.insert_one(emp.model_dump())
    return emp


@api.put("/employees/{emp_id}", response_model=Employee)
async def update_employee(emp_id: str, data: EmployeeIn):
    res = await db.employees.find_one_and_update(
        {"id": emp_id}, {"$set": data.model_dump()}, projection={"_id": 0}, return_document=True
    )
    if not res:
        raise HTTPException(404, "Funcionário não encontrado")
    return Employee(**res)


@api.delete("/employees/{emp_id}")
async def delete_employee(emp_id: str):
    res = await db.employees.delete_one({"id": emp_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Funcionário não encontrado")
    sched = await get_schedule()
    sched.off_days.pop(emp_id, None)
    await save(db.schedule, sched)
    return {"ok": True}


@api.get("/movement", response_model=Movement)
async def movement():
    return await get_movement()


@api.post("/movement/import", response_model=Movement)
async def import_movement(data: CsvImport):
    text = data.csv.lstrip("\ufeff")
    delimiter = ";" if text.count(";") > text.count(",") else ","
    totals, counts, records = [0.0] * 7, [0] * 7, 0
    for row in csv.reader(io.StringIO(text), delimiter=delimiter):
        if len(row) < 2:
            continue
        date, value = parse_date(row[0]), parse_number(row[1])
        if date is None or value is None:
            continue
        wd = date.weekday()
        totals[wd] += value
        counts[wd] += 1
        records += 1
    if records == 0:
        raise HTTPException(400, "Nenhum registro válido encontrado. Use o formato: data,clientes")
    avg = [round(totals[i] / counts[i], 1) if counts[i] else 0.0 for i in range(7)]
    mean = sum(avg) / 7
    peaks = sorted([i for i in range(7) if avg[i] >= mean * 1.15], key=lambda i: -avg[i])[:3]
    if not peaks:
        peaks = [max(range(7), key=lambda i: avg[i])]
    mov = Movement(avg=avg, samples=counts, peak_days=sorted(peaks), total_records=records, updated_at=now_iso())
    await save(db.movement, mov)
    return mov


@api.put("/movement/peaks", response_model=Movement)
async def set_peaks(data: PeaksIn):
    mov = await get_movement()
    mov.peak_days = sorted({d for d in data.peak_days if 0 <= d <= 6})
    mov.updated_at = now_iso()
    await save(db.movement, mov)
    return mov


@api.get("/schedule", response_model=Schedule)
async def schedule():
    return await get_schedule()


@api.post("/schedule/generate", response_model=Schedule)
async def generate(data: GenerateIn):
    employees = await list_employees()
    mov = await get_movement()
    sched = Schedule(mode=data.mode, off_days=compute_schedule(employees, mov, data.mode), generated_at=now_iso())
    await save(db.schedule, sched)
    return sched


@api.put("/schedule/cell", response_model=Schedule)
async def toggle_cell(data: CellToggle):
    if not await db.employees.find_one({"id": data.employee_id}):
        raise HTTPException(404, "Funcionário não encontrado")
    sched = await get_schedule()
    days = set(sched.off_days.get(data.employee_id, []))
    days.symmetric_difference_update({data.day})
    sched.off_days[data.employee_id] = sorted(days)
    await save(db.schedule, sched)
    return sched


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

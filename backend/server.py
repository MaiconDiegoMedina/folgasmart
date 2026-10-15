from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from dotenv import load_dotenv
import httpx
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
from datetime import datetime, timezone, timedelta

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
    user_id: str = ""
    created_at: str = Field(default_factory=now_iso)


class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: str | None = None


class SessionIn(BaseModel):
    session_id: str


EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_DAYS = 7


async def get_user(request: Request) -> User:
    token = request.cookies.get("session_token")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(401, "Não autenticado")
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(401, "Sessão inválida")
    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, "Sessão expirada")
    doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(401, "Usuário não encontrado")
    return User(**doc)


async def claim_legacy_data(uid: str):
    await db.employees.update_many({"user_id": {"$exists": False}}, {"$set": {"user_id": uid}})
    for coll in (db.movement, db.schedule):
        if not await coll.find_one({"_key": uid}):
            await coll.update_one({"_key": "main"}, {"$set": {"_key": uid}})


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


async def get_movement(uid: str) -> Movement:
    doc = await db.movement.find_one({"_key": uid}, {"_id": 0, "_key": 0})
    return Movement(**doc) if doc else Movement()


async def get_schedule(uid: str) -> Schedule:
    doc = await db.schedule.find_one({"_key": uid}, {"_id": 0, "_key": 0})
    return Schedule(**doc) if doc else Schedule()


async def save(collection, uid: str, model: BaseModel):
    await collection.replace_one({"_key": uid}, {"_key": uid, **model.model_dump()}, upsert=True)


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


async def list_employees(uid: str) -> List[Employee]:
    docs = await db.employees.find({"user_id": uid}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    return [Employee(**d) for d in docs]


@api.get("/")
async def root():
    return {"message": "FolgaSmart API"}


@api.post("/auth/session", response_model=User)
async def create_session(data: SessionIn, response: Response):
    try:
        async with httpx.AsyncClient(timeout=15) as http_client:
            r = await http_client.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": data.session_id})
    except httpx.HTTPError:
        raise HTTPException(502, "Serviço de login indisponível")
    info = r.json() if r.status_code == 200 else {}
    if not all(info.get(k) for k in ("email", "name", "session_token")):
        raise HTTPException(401, "Sessão do Google inválida")
    existing = await db.users.find_one({"email": info["email"]}, {"_id": 0})
    if existing:
        uid = existing["user_id"]
        await db.users.update_one({"user_id": uid}, {"$set": {"name": info["name"], "picture": info.get("picture")}})
    else:
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({"user_id": uid, "email": info["email"], "name": info["name"],
                                   "picture": info.get("picture"), "created_at": now_iso()})
        await claim_legacy_data(uid)
    await db.user_sessions.insert_one({"user_id": uid, "session_token": info["session_token"],
                                       "expires_at": datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
                                       "created_at": now_iso()})
    response.set_cookie("session_token", info["session_token"], max_age=SESSION_DAYS * 86400,
                        path="/", httponly=True, secure=True, samesite="none")
    return User(**(await db.users.find_one({"user_id": uid}, {"_id": 0})))


@api.get("/auth/me", response_model=User)
async def me(user: User = Depends(get_user)):
    return user


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", secure=True, samesite="none")
    return {"ok": True}


@api.get("/employees", response_model=List[Employee])
async def get_employees(user: User = Depends(get_user)):
    return await list_employees(user.user_id)


@api.post("/employees", response_model=Employee)
async def create_employee(data: EmployeeIn, user: User = Depends(get_user)):
    emp = Employee(**data.model_dump(), user_id=user.user_id)
    await db.employees.insert_one(emp.model_dump())
    return emp


@api.put("/employees/{emp_id}", response_model=Employee)
async def update_employee(emp_id: str, data: EmployeeIn, user: User = Depends(get_user)):
    res = await db.employees.find_one_and_update(
        {"id": emp_id, "user_id": user.user_id}, {"$set": data.model_dump()}, projection={"_id": 0}, return_document=True
    )
    if not res:
        raise HTTPException(404, "Funcionário não encontrado")
    return Employee(**res)


@api.delete("/employees/{emp_id}")
async def delete_employee(emp_id: str, user: User = Depends(get_user)):
    res = await db.employees.delete_one({"id": emp_id, "user_id": user.user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Funcionário não encontrado")
    sched = await get_schedule(user.user_id)
    sched.off_days.pop(emp_id, None)
    await save(db.schedule, user.user_id, sched)
    return {"ok": True}


@api.get("/movement", response_model=Movement)
async def movement(user: User = Depends(get_user)):
    return await get_movement(user.user_id)


@api.post("/movement/import", response_model=Movement)
async def import_movement(data: CsvImport, user: User = Depends(get_user)):
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
    await save(db.movement, user.user_id, mov)
    return mov


@api.put("/movement/peaks", response_model=Movement)
async def set_peaks(data: PeaksIn, user: User = Depends(get_user)):
    mov = await get_movement(user.user_id)
    mov.peak_days = sorted({d for d in data.peak_days if 0 <= d <= 6})
    mov.updated_at = now_iso()
    await save(db.movement, user.user_id, mov)
    return mov


@api.get("/schedule", response_model=Schedule)
async def schedule(user: User = Depends(get_user)):
    return await get_schedule(user.user_id)


@api.post("/schedule/generate", response_model=Schedule)
async def generate(data: GenerateIn, user: User = Depends(get_user)):
    employees = await list_employees(user.user_id)
    mov = await get_movement(user.user_id)
    sched = Schedule(mode=data.mode, off_days=compute_schedule(employees, mov, data.mode), generated_at=now_iso())
    await save(db.schedule, user.user_id, sched)
    return sched


@api.put("/schedule/cell", response_model=Schedule)
async def toggle_cell(data: CellToggle, user: User = Depends(get_user)):
    if not await db.employees.find_one({"id": data.employee_id, "user_id": user.user_id}):
        raise HTTPException(404, "Funcionário não encontrado")
    sched = await get_schedule(user.user_id)
    days = set(sched.off_days.get(data.employee_id, []))
    days.symmetric_difference_update({data.day})
    sched.off_days[data.employee_id] = sorted(days)
    await save(db.schedule, user.user_id, sched)
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


@app.on_event("startup")
async def create_indexes():
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.user_sessions.create_index("session_token")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { http, errMsg, isoDate, mondayOf } from "@/lib/api";
import { PageTitle } from "@/components/folga/Header";
import { AppRail, TABS } from "@/components/folga/AppRail";
import { HomePanel } from "@/components/folga/HomePanel";
import { CheckoutsBoard } from "@/components/folga/CheckoutsBoard";
import { SectorBoard, SECTOR_TABS } from "@/components/folga/SectorBoard";
import { WeekNav } from "@/components/folga/WeekNav";
import { MovementPanel } from "@/components/folga/MovementPanel";
import { EmployeesPanel } from "@/components/folga/EmployeesPanel";
import { WorkloadsPanel } from "@/components/folga/WorkloadsPanel";
import { CheckoutsPanel } from "@/components/folga/CheckoutsPanel";
import { HolidaysPanel } from "@/components/folga/HolidaysPanel";
import { ScheduleGrid } from "@/components/folga/ScheduleGrid";
import { UnlockDialog } from "@/components/folga/UnlockDialog";
import { useAuth } from "@/components/LoginGate";

const TAB_KEY = "escalasmart.tab";
const readTab = () => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? t : "escala";
  } catch {
    return "escala";
  }
};

export default function Dashboard() {
  const { logout } = useAuth();
  const [tab, setTabState] = useState(readTab);
  const setTab = (t) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* sem armazenamento: só não lembra a aba */ }
    window.scrollTo({ top: 0 });
  };
  const [employees, setEmployees] = useState([]);
  const [movement, setMovement] = useState(null);
  const [week, setWeek] = useState(() => isoDate(mondayOf(new Date())));
  const [schedule, setSchedule] = useState({ mode: "6x1", off_days: {}, extra_days: {} });
  const [generating, setGenerating] = useState(false);
  const [sectorModes, setSectorModes] = useState({});
  const [workloads, setWorkloads] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [checkouts, setCheckouts] = useState([]);
  const [sector, setSector] = useState("all");
  // Inativos ficam fora da escala, da geração e da exportação
  const scheduled = employees.filter((e) => e.status !== "inativo");
  const activeSector = scheduled.some((e) => e.sector === sector) ? sector : null;

  const load = useCallback(async () => {
    // Cada pedido é independente: se um falhar (ex.: servidor ainda sem a rota nova), o resto carrega
    const requests = [
      ["/employees", setEmployees],
      ["/sectors/modes", setSectorModes],
      ["/workloads", setWorkloads],
      ["/vacations", setVacations],
      ["/checkouts", setCheckouts],
    ];
    const results = await Promise.allSettled(requests.map(([url]) => http.get(url)));
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") requests[i][1](r.value.data);
      else failed.push(requests[i][0]);
    });
    if (failed.includes("/employees")) toast.error(errMsg(results[0].reason));
    else if (failed.length) toast.error(`Algumas funções estão indisponíveis no servidor (${failed.join(", ")}). Atualize o worker.`);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    http.get("/movement", { params: { week } }).then(({ data }) => setMovement(data)).catch(() => setMovement(null));
  }, [week]);
  useEffect(() => {
    http.get("/schedule", { params: { week } }).then(({ data }) => setSchedule(data)).catch((err) => toast.error(errMsg(err)));
  }, [week, employees]);

  // Com um setor selecionado, gera só ele; os outros setores ficam como estão
  const generate = async () => {
    if (!scheduled.length) return toast.error("Cadastre ao menos um funcionário ativo.");
    if (schedule.generated_at) {
      const msg = activeSector
        ? `Gerar de novo a escala do setor ${activeSector}? Os ajustes manuais desse setor nesta semana serão refeitos. Os outros setores não mudam.`
        : "Gerar de novo a escala de TODOS os setores? Os ajustes manuais da semana serão refeitos.";
      if (!window.confirm(msg)) return;
    }
    setGenerating(true);
    try {
      const { data } = await http.post("/schedule/generate", { mode: "6x1", week, sector: activeSector });
      setSchedule(data);
      toast.success(activeSector ? `Escala do setor ${activeSector} gerada` : "Escala de todos os setores gerada");
    } catch (err) { toast.error(errMsg(err)); }
    finally { setGenerating(false); }
  };

  const changeSectorMode = async (sector, mode) => {
    try {
      const { data } = await http.put("/sectors/mode", { sector, mode });
      setSectorModes(data);
      toast.success(`${sector} agora usa a escala ${mode}. Clique em Gerar escala para aplicar nesta semana.`);
    } catch (err) { toast.error(errMsg(err)); }
  };

  const toggleCell = async (employee_id, day, markExtra = false) => {
    try {
      const { data } = await http.put("/schedule/cell", { employee_id, day, week, extra: markExtra });
      setSchedule(data);
    } catch (err) { toast.error(errMsg(err)); }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F3F1FA] text-[#1B1830]">
      <div className="blob no-print" style={{ width: 520, height: 520, background: "#C9BFFF", top: -200, left: "38%" }} />
      <div className="blob no-print" style={{ width: 420, height: 420, background: "#FFD9E8", bottom: -160, right: -120 }} />
      <div className="relative z-10 flex gap-6 p-3.5 pb-28 sm:p-6 md:pb-6">
        <AppRail tab={tab} onTab={setTab} onLogout={logout} />
        <main className="min-w-0 flex-1 space-y-6">
          <UnlockDialog />
          {tab === "inicio" && <HomePanel employees={scheduled} schedule={schedule} movement={movement} week={week} onTab={setTab} />}
          {tab === "escala" && (
            <>
              <ScheduleGrid employees={scheduled} movement={movement} schedule={schedule} week={week} onWeekChange={setWeek} onToggle={toggleCell} sectorModes={sectorModes} onSectorMode={changeSectorMode} workloads={workloads} checkouts={checkouts} sector={sector} onSectorChange={setSector} onGenerate={generate} generating={generating} generateSector={activeSector} />
            </>
          )}
          {tab === "funcionarios" && (
            <>
              <EmployeesPanel employees={employees} workloads={workloads} vacations={vacations} onChange={load} schedule={schedule} week={week} sectorModes={sectorModes} />
            </>
          )}
          {tab === "jornadas" && (
            <>
              <WorkloadsPanel workloads={workloads} employees={employees} onChange={load} />
            </>
          )}
          {tab === "movimento" && (
            <>
              <MovementPanel movement={movement} onChange={setMovement} week={week} onWeek={setWeek} />
            </>
          )}
          {tab === "caixas" && (
            <>
              <CheckoutsBoard employees={scheduled} schedule={schedule} week={week} onWeek={setWeek} workloads={workloads} sectorModes={sectorModes} checkouts={checkouts} onChange={load} />
            </>
          )}
          {SECTOR_TABS.some((t) => t.id === tab) && (
            <SectorBoard key={tab} tab={tab} employees={scheduled} schedule={schedule} week={week} onWeek={setWeek} workloads={workloads} sectorModes={sectorModes} />
          )}
          {tab === "feriados" && (
            <>
              <HolidaysPanel onChange={load} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

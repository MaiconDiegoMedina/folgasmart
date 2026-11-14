import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { http, errMsg, isoDate, mondayOf } from "@/lib/api";
import { Header } from "@/components/folga/Header";
import { MovementPanel } from "@/components/folga/MovementPanel";
import { EmployeesPanel } from "@/components/folga/EmployeesPanel";
import { WorkloadsPanel } from "@/components/folga/WorkloadsPanel";
import { ScheduleGrid } from "@/components/folga/ScheduleGrid";
import { useAuth } from "@/components/LoginGate";

export default function Dashboard() {
  const { logout } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [movement, setMovement] = useState(null);
  const [week, setWeek] = useState(() => isoDate(mondayOf(new Date())));
  const [schedule, setSchedule] = useState({ mode: "6x1", off_days: {}, extra_days: {} });
  const [generating, setGenerating] = useState(false);
  const [sectorModes, setSectorModes] = useState({});
  const [workloads, setWorkloads] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [sector, setSector] = useState("all");
  // Inativos ficam fora da escala, da geração e da exportação
  const scheduled = employees.filter((e) => e.status !== "inativo");
  const activeSector = scheduled.some((e) => e.sector === sector) ? sector : null;

  const load = useCallback(async () => {
    // Cada pedido é independente: se um falhar (ex.: servidor ainda sem a rota nova), o resto carrega
    const requests = [
      ["/employees", setEmployees],
      ["/movement", setMovement],
      ["/sectors/modes", setSectorModes],
      ["/workloads", setWorkloads],
      ["/vacations", setVacations],
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
    <div className="grain min-h-screen bg-[#F9F8F5] text-[#191C1E]">
      <Header onLogout={logout} employees={scheduled} movement={movement} schedule={schedule} generating={generating} onGenerate={generate} generateSector={activeSector} />
      <main className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <ScheduleGrid employees={scheduled} movement={movement} schedule={schedule} week={week} onWeekChange={setWeek} onToggle={toggleCell} sectorModes={sectorModes} onSectorMode={changeSectorMode} workloads={workloads} sector={sector} onSectorChange={setSector} />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 no-print">
          <div className="lg:col-span-3"><MovementPanel movement={movement} onChange={setMovement} /></div>
          <div className="lg:col-span-2"><EmployeesPanel employees={employees} workloads={workloads} vacations={vacations} onChange={load} /></div>
        </div>
        <div className="no-print"><WorkloadsPanel workloads={workloads} onChange={load} /></div>
      </main>
    </div>
  );
}

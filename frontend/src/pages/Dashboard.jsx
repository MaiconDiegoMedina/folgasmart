import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { http, errMsg, isoDate, mondayOf } from "@/lib/api";
import { Header } from "@/components/folga/Header";
import { MovementPanel } from "@/components/folga/MovementPanel";
import { EmployeesPanel } from "@/components/folga/EmployeesPanel";
import { ScheduleGrid } from "@/components/folga/ScheduleGrid";
import { useAuth } from "@/components/LoginGate";

export default function Dashboard() {
  const { logout } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [movement, setMovement] = useState(null);
  const [week, setWeek] = useState(() => isoDate(mondayOf(new Date())));
  const [schedule, setSchedule] = useState({ mode: "6x1", off_days: {} });
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, m] = await Promise.all([http.get("/employees"), http.get("/movement")]);
      setEmployees(e.data);
      setMovement(m.data);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    http.get("/schedule", { params: { week } }).then(({ data }) => setSchedule(data)).catch((err) => toast.error(errMsg(err)));
  }, [week, employees]);

  const generate = async (mode = schedule.mode) => {
    if (!employees.length) return toast.error("Cadastre ao menos um funcionário.");
    setGenerating(true);
    try {
      const { data } = await http.post("/schedule/generate", { mode, week });
      setSchedule(data);
      toast.success(`Escala ${mode} gerada para a semana`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setGenerating(false);
    }
  };

  const toggleCell = async (employee_id, day) => {
    try {
      const { data } = await http.put("/schedule/cell", { employee_id, day, week });
      setSchedule(data);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="grain min-h-screen bg-[#F9F8F5] text-[#191C1E]">
      <Header
        onLogout={logout}
        employees={employees}
        movement={movement}
        schedule={schedule}
        generating={generating}
        onGenerate={generate}
        onModeChange={(mode) => generate(mode)}
      />
      <main className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <ScheduleGrid employees={employees} movement={movement} schedule={schedule} week={week} onWeekChange={setWeek} onToggle={toggleCell} />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 no-print">
          <div className="lg:col-span-3">
            <MovementPanel movement={movement} onChange={setMovement} />
          </div>
          <div className="lg:col-span-2">
            <EmployeesPanel employees={employees} onChange={load} />
          </div>
        </div>
      </main>
    </div>
  );
}

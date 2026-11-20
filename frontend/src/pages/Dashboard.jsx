import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { http, errMsg, isoDate, mondayOf, addDays, parseIso } from "@/lib/api";
import { isIntermittent } from "@/lib/convocation";
import { PageTitle } from "@/components/folga/Header";
import { AppRail, TABS } from "@/components/folga/AppRail";
import { HomePanel } from "@/components/folga/HomePanel";
import { CheckoutsBoard } from "@/components/folga/CheckoutsBoard";
import { SectorBoard } from "@/components/folga/SectorBoard";
import { sectorTabsOf } from "@/lib/sectorIcons";
import { WeekNav } from "@/components/folga/WeekNav";
import { MovementPanel } from "@/components/folga/MovementPanel";
import { EmployeesPanel } from "@/components/folga/EmployeesPanel";
import { WorkloadsPanel } from "@/components/folga/WorkloadsPanel";
import { CheckoutsPanel } from "@/components/folga/CheckoutsPanel";
import { HolidaysPanel } from "@/components/folga/HolidaysPanel";
import { ScheduleGrid } from "@/components/folga/ScheduleGrid";
import { UnlockDialog } from "@/components/folga/UnlockDialog";
import { SettingsPanel } from "@/components/folga/SettingsPanel";
import { ModeChangeNotice } from "@/components/folga/ModeChangeNotice";
import { setScaleModels, modeLabel } from "@/lib/scaleModels";
import { useAuth } from "@/components/LoginGate";

// A aba aberta vale só para o login atual (recarregar a página mantém); cada novo login abre no Início
const TAB_KEY = "escalasmart.tab";
const readTab = () => {
  try {
    localStorage.removeItem(TAB_KEY); // versões antigas guardavam a aba para sempre
    const t = sessionStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) || t?.startsWith("setor:") ? t : "inicio";
  } catch {
    return "inicio";
  }
};

// Próximo estado da célula, igual ao servidor: TRAB. -> FOLGA -> SUSP. -> FALTA -> TRAB.;
// EXTRA liga/desliga numa folga; intermitente: convocado -> aceitou -> recusou -> nada
const nextCell = (s, emp, day, markExtra) => {
  if (isIntermittent(emp)) {
    if (markExtra) return null;
    const days = { ...(s.convocations?.[emp.id] || {}) };
    const key = String(day);
    const cur = days[key]?.status;
    if (cur == null) days[key] = { status: "pending", at: isoDate(new Date()) };
    else if (cur === "pending") days[key] = { ...days[key], status: "accepted" };
    else if (cur === "accepted") days[key] = { ...days[key], status: "declined" };
    else delete days[key];
    return { ...s, convocations: { ...(s.convocations || {}), [emp.id]: days } };
  }
  const list = (k) => [...(s[k]?.[emp.id] || [])];
  const off = list("off_days");
  const susp = list("suspension_days");
  const abs = list("absence_days");
  const ext = list("extra_days");
  const drop = (a) => a.splice(a.indexOf(day), 1);
  if (markExtra) {
    if (!off.includes(day) || emp.status === "ferias") return null;
    if (ext.includes(day)) drop(ext);
    else ext.push(day);
  } else if (ext.includes(day)) drop(ext);
  else if (off.includes(day)) { drop(off); susp.push(day); }
  else if (susp.includes(day)) { drop(susp); abs.push(day); }
  else if (abs.includes(day)) drop(abs);
  else off.push(day);
  const set = (k, a) => ({ ...(s[k] || {}), [emp.id]: a.sort((x, y) => x - y) });
  return { ...s, off_days: set("off_days", off), suspension_days: set("suspension_days", susp), absence_days: set("absence_days", abs), extra_days: set("extra_days", ext) };
};

export default function Dashboard() {
  const { logout } = useAuth();
  const [tab, setTabState] = useState(readTab);
  const [settingsSection, setSettingsSection] = useState("setores");
  // "configuracoes:feriados" abre direto uma seção das Configurações
  const setTab = (target) => {
    const [first, section] = target.split(":");
    const t = first === "configuracoes" ? first : target; // "setor:açougue" é o id da aba do setor
    if (first === "configuracoes" && section) setSettingsSection(section);
    setTabState(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* sem armazenamento: só não lembra a aba */ }
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
  const [models, setModels] = useState([]);
  const [sectorList, setSectorList] = useState([]);
  const [sector, setSector] = useState("all");
  const sectorTabs = useMemo(() => sectorTabsOf(sectorList), [sectorList]);
  const sectorConf = sectorTabs.find((t) => t.id === tab);
  // Aba de um setor que foi excluído ou renomeado: volta ao Início
  useEffect(() => {
    if (sectorList.length && tab.startsWith("setor:") && !sectorConf) setTabState("inicio");
  }, [sectorList, tab, sectorConf]);
  // Inativos ficam fora da escala, da geração e da exportação
  const scheduled = employees.filter((e) => e.status !== "inativo");
  const activeSector = scheduled.some((e) => e.sector === sector) ? sector : null;

  const load = useCallback(async () => {
    // Cada pedido é independente: se um falhar (ex.: servidor ainda sem a rota nova), o resto carrega
    const requests = [
      ["/employees", setEmployees],
      ["/workloads", setWorkloads],
      ["/scale-models", (list) => { setScaleModels(list); setModels(list); }],
      ["/sectors", setSectorList],
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
  // Escala de cada setor vale a partir de uma data: a da semana aberta
  const loadModes = useCallback(() => {
    http.get("/sectors/modes", { params: { week } }).then(({ data }) => setSectorModes(data)).catch(() => {});
  }, [week]);
  useEffect(() => { loadModes(); }, [loadModes, employees]);
  useEffect(() => {
    http.get("/schedule", { params: { week } }).then(({ data }) => setSchedule(data)).catch((err) => toast.error(errMsg(err)));
  }, [week, employees]);

  // Com um setor selecionado, gera só ele; os outros setores ficam como estão.
  // mode (6x1/5x2) vem da pergunta do botão e passa a ser a escala do setor; null mantém a de cada setor.
  const generate = async (mode = null) => {
    if (!scheduled.length) return toast.error("Cadastre ao menos um funcionário ativo.");
    setGenerating(true);
    // O servidor gera com a escala salva de cada setor, então ela é gravada antes; se a geração falhar, volta como era
    const modeOf = (s) => sectorModes[s.toLowerCase()] || "6x1";
    const targets = activeSector ? [activeSector] : [...new Set(scheduled.map((e) => e.sector))];
    const changed = mode ? targets.filter((s) => modeOf(s) !== mode).map((s) => [s, modeOf(s)]) : [];
    const saved = [];
    try {
      for (const [sector] of changed) {
        const { data: modes } = await http.put("/sectors/mode", { sector, mode, week });
        saved.push(changed.find(([s]) => s === sector));
        setSectorModes(modes);
      }
      const { data } = await http.post("/schedule/generate", { mode: "6x1", week, sector: activeSector });
      setSchedule(data);
      toast.success(`${activeSector ? `Escala do setor ${activeSector}` : "Escala de todos os setores"} gerada${mode ? ` em ${modeLabel(mode)}` : ""}`);
    } catch (err) {
      toast.error(errMsg(err));
      for (const [sector, previous] of saved) {
        try {
          const { data: modes } = await http.put("/sectors/mode", { sector, mode: previous, week });
          setSectorModes(modes);
        } catch { /* fica a escala nova; a próxima geração pergunta de novo */ }
      }
    }
    finally { setGenerating(false); }
  };

  // Clique na escala: o ícone troca na hora (mesmo ciclo do servidor) e o salvamento segue em fila.
  // Vale a resposta do último clique; se o servidor recusar, a escala volta ao que está salvo.
  const cellQueue = useRef(Promise.resolve());
  const cellSeq = useRef(0);
  const weekRef = useRef(week);
  weekRef.current = week;
  const toggleCell = (employee_id, day, markExtra = false) => {
    const emp = employees.find((e) => e.id === employee_id);
    const quick = emp && !(schedule.closed_days || []).includes(day) && isoDate(addDays(parseIso(week), day)) >= isoDate(new Date());
    if (quick) setSchedule((s) => nextCell(s, emp, day, markExtra) || s);
    const seq = ++cellSeq.current;
    const w = week;
    cellQueue.current = cellQueue.current.then(async () => {
      try {
        const { data } = await http.put("/schedule/cell", { employee_id, day, week: w, extra: markExtra });
        if (seq === cellSeq.current && weekRef.current === w) setSchedule(data);
      } catch (err) {
        toast.error(errMsg(err));
        if (seq === cellSeq.current && weekRef.current === w) {
          http.get("/schedule", { params: { week: w } }).then(({ data }) => weekRef.current === w && setSchedule(data)).catch(() => {});
        }
      }
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F3F1FA] text-[#1B1830]">
      <div className="blob no-print" style={{ width: 520, height: 520, background: "#C9BFFF", top: -200, left: "38%" }} />
      <div className="blob no-print" style={{ width: 420, height: 420, background: "#FFD9E8", bottom: -160, right: -120 }} />
      <div className="relative z-10 flex gap-6 p-3.5 pb-28 sm:p-6 md:pb-6">
        <AppRail tab={tab} onTab={setTab} onLogout={logout} sectorTabs={sectorTabs} />
        <main className="min-w-0 flex-1 space-y-6">
          <UnlockDialog />
          <ModeChangeNotice models={models} />
          {tab === "inicio" && <HomePanel employees={scheduled} schedule={schedule} movement={movement} week={week} onTab={setTab} />}
          {tab === "escala" && (
            <>
              <ScheduleGrid employees={scheduled} movement={movement} schedule={schedule} week={week} onWeekChange={setWeek} onToggle={toggleCell} onSchedule={setSchedule} sectorModes={sectorModes} workloads={workloads} checkouts={checkouts} sector={sector} onSectorChange={setSector} onGenerate={generate} generating={generating} generateSector={activeSector} />
            </>
          )}
          {tab === "funcionarios" && (
            <>
              <EmployeesPanel sectorList={sectorList} employees={employees} workloads={workloads} vacations={vacations} onChange={load} schedule={schedule} week={week} sectorModes={sectorModes} />
            </>
          )}
          {tab === "configuracoes" && (
            <SettingsPanel
              section={settingsSection}
              onSection={setSettingsSection}
              sectors={sectorList}
              models={models}
              onChange={() => { load(); loadModes(); }}
              workloadsPanel={<WorkloadsPanel workloads={workloads} employees={employees} onChange={load} />}
              holidaysPanel={<HolidaysPanel onChange={load} />}
            />
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
          {sectorConf && (
            <SectorBoard key={tab} conf={sectorConf} employees={scheduled} schedule={schedule} week={week} onWeek={setWeek} workloads={workloads} sectorModes={sectorModes} />
          )}
        </main>
      </div>
    </div>
  );
}

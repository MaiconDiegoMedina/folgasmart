import { useState } from "react";
import { Plus, Trash2, Loader2, Search, Pencil, BadgeCheck, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg, isoDate, addDays, parseIso, weekDates, DAYS_SHORT, OFFS_PER_MODE } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageTitle } from "@/components/folga/Header";
import { isIntermittent, acceptedOn } from "@/lib/convocation";
import { ImportEmployees } from "@/components/folga/ImportEmployees";
import { VacationDialog, fmtDate } from "@/components/folga/VacationDialog";
import { RoleDialog, isTrial } from "@/components/folga/RoleDialog";
import { weekModeOf } from "@/lib/weekMode";

// Comparação sem acento e sem diferenciar maiúsculas
const fold = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const EMPTY = { name: "", role: "", sector: "", status: "ativo", gender: "", workload: "", contract: "efetivo" };
const selectCls = "text-xs bg-[#F7F5FC] border border-[#E4E0F3] rounded-lg px-2 py-1.5 text-[#5E5880] font-medium outline-none focus:border-[#17142E] transition-colors";

const EmployeeForm = ({ sectors, roles, workloads, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.role.trim() || !form.sector.trim()) return toast.error("Preencha nome, cargo e setor.");
    if (!form.gender) return toast.error("Informe o sexo (usado na regra de domingos da CCT).");
    if (!form.workload) return toast.error("Informe a jornada do funcionário.");
    setBusy(true);
    try {
      await http.post("/employees", { 
        name: form.name.trim(), 
        role: form.role.trim(), 
        sector: form.sector.trim(),
        status: "ativo",
        gender: form.gender,
        workload: form.workload,
        contract: form.contract
      });
      toast.success("Funcionário adicionado — clique em Gerar escala para recalcular as folgas");
      setForm(EMPTY);
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-testid="employee-form" onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <Input data-testid="input-employee-name" placeholder="Nome" value={form.name} onChange={set("name")} />
      <Input data-testid="input-employee-role" placeholder="Cargo (ex.: Teste)" list="roles" value={form.role} onChange={set("role")} />
      <Input data-testid="select-employee-sector" placeholder="Setor" list="sectors" value={form.sector} onChange={set("sector")} />
      <select data-testid="select-employee-gender" value={form.gender} onChange={set("gender")} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
        <option value="">Sexo</option>
        <option value="M">Masculino</option>
        <option value="F">Feminino</option>
      </select>
      <select data-testid="select-employee-workload" value={form.workload} onChange={set("workload")} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
        <option value="">Jornada</option>
        {workloads.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <select data-testid="select-employee-contract" value={form.contract} onChange={set("contract")} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
        <option value="efetivo">Efetivo</option>
        <option value="intermitente">Intermitente</option>
      </select>
      <datalist id="sectors">{sectors.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
      <Button data-testid="btn-save-employee" type="submit" disabled={busy} className="sm:col-span-2 bg-[#17142E] hover:bg-[#2A2550] text-white">
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} Adicionar funcionário
      </Button>
    </form>
  );
};

const OK = "bg-[#E3F5EC] text-[#1D6B45]";
const WARN = "bg-[#FFF4D1] text-[#7A5500]";
const RISK = "bg-[#FDE2E2] text-[#A12828]";
const Chip = ({ className = "", children, title }) => (
  <span title={title} className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ${className}`}>{children}</span>
);
const initials = (n) => n.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const fem = (e) => e.gender === "F";

const Stat = ({ label, value, tone = "", active, onClick }) => (
  <button onClick={onClick} className={`rounded-[26px] border p-5 text-left transition ${tone || "glass"} ${active ? "ring-2 ring-[#6D5BD0]" : ""}`}>
    <p className="text-[13px] font-semibold opacity-90">{label}</p>
    <p className="mt-2 font-display text-[34px] font-semibold leading-none tracking-tight">{value}</p>
  </button>
);

// Equipe em cartões: situação, vínculo, jornada e a folga da semana
export const EmployeesPanel = ({ employees, workloads = [], vacations = [], onChange, schedule = {}, week, sectorModes = {} }) => {
  const sectors = [...new Set(employees.map((e) => e.sector))];
  const roles = [...new Set(employees.map((e) => e.role))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const [roleFor, setRoleFor] = useState(null);
  const [vacationFor, setVacationFor] = useState(null);
  const [leaveKind, setLeaveKind] = useState("ferias");
  const [editFor, setEditFor] = useState(null);
  const [adding, setAdding] = useState(false);
  const [sector, setSector] = useState("all");
  const [statFilter, setStatFilter] = useState(null);
  const openLeave = (emp, kind) => { setEditFor(null); setLeaveKind(kind); setVacationFor(emp); };
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const today = isoDate(new Date());
  const dates = week ? weekDates(week) : [];
  const upcoming = (emp) => vacations.filter((v) => v.employee_id === emp.id && v.end >= today);
  const current = (emp) => vacations.find((v) => v.employee_id === emp.id && v.start <= today && v.end >= today);
  const away = (e) => e.status === "ferias" || e.status === "atestado" || !!current(e);
  const modeOf = (s) => weekModeOf(schedule, sectorModes, s);
  const offsOf = (e) => (schedule.off_days?.[e.id] || []).filter((d) => !(schedule.extra_days?.[e.id] || []).includes(d));
  const weekVacation = (e) => (schedule.vacation_days?.[e.id] || []).length > 0;
  const noOff = (e) => e.status !== "inativo" && !isIntermittent(e) && !away(e) && !weekVacation(e) && !!schedule.generated_at && offsOf(e).length < OFFS_PER_MODE[modeOf(e.sector)];
  const streakDays = (e) => schedule.streak_alerts?.[e.id] || [];
  const active = employees.filter((e) => e.status !== "inativo");

  const STATS = [
    { id: "efetivo", label: "Efetivos", test: (e) => e.status !== "inativo" && !isIntermittent(e) },
    { id: "intermitente", label: "Intermitentes", test: (e) => e.status !== "inativo" && isIntermittent(e) },
    { id: "away", label: "De férias ou atestado", test: (e) => e.status !== "inativo" && away(e) },
    { id: "inativo", label: "Inativos", test: (e) => e.status === "inativo" },
    { id: "nooff", label: "Sem folga na semana", test: noOff, risk: true },
  ];
  const statTest = STATS.find((s) => s.id === statFilter)?.test || (() => true);
  const list = employees
    .filter((e) => sector === "all" || e.sector === sector)
    .filter(statTest)
    .filter((e) => !q || fold(`${e.name} ${e.role} ${e.sector}`).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

  const remove = async (emp) => {
    if (!window.confirm(`Excluir ${emp.name}? Essa ação não pode ser desfeita. Para tirar só da escala, use o status Inativo.`)) return;
    try {
      await http.delete(`/employees/${emp.id}`);
      toast.success(`${emp.name} removido`);
      setEditFor(null);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Atualiza status, sexo, jornada ou contrato, sempre enviando todos os campos
  const update = async (emp, patch, message) => {
    try {
      await http.put(`/employees/${emp.id}`, {
        name: emp.name,
        role: emp.role,
        sector: emp.sector,
        status: emp.status || "ativo",
        gender: emp.gender || null,
        workload: emp.workload || null,
        contract: emp.contract || null,
        ...patch
      });
      toast.success(message);
      onChange(); // Atualiza a escala na tela imediatamente
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const footer = (e) => {
    const v = current(e);
    if (v) return ["Volta", fmtDate(isoDate(addDays(parseIso(v.end), 1))).slice(0, 5)];
    if (e.status === "inativo") return ["Fora da escala", "—"];
    if (isIntermittent(e)) {
      const n = DAYS_SHORT.filter((_, d) => acceptedOn(schedule, e.id, d)).length;
      return [`${fem(e) ? "Convocada" : "Convocado"} esta semana`, `${n} ${n === 1 ? "dia" : "dias"}`];
    }
    if (weekVacation(e)) return ["Folga nesta semana", "Férias"];
    if (!schedule.generated_at) return ["Folga nesta semana", "escala não gerada"];
    const offs = offsOf(e);
    if (!offs.length) return ["Folga nesta semana", "Sem folga", true];
    return ["Folga nesta semana", offs.map((d) => `${DAYS_SHORT[d]} ${dates[d] ? dates[d].getDate() : ""}`.trim()).join(", ")];
  };

  // Sempre a versão mais nova do funcionário que está sendo editado
  const editing = editFor && employees.find((x) => x.id === editFor.id);
  const field = `${selectCls} h-10 w-full text-sm`;

  return (
    <section data-testid="employees-panel" className="space-y-5">
      <PageTitle
        eyebrow={`Equipe · ${active.length} ativos`}
        actions={
          <>
            {employees.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5E5880]" />
                <input
                  data-testid="input-employee-search"
                  placeholder="Buscar por nome, cargo ou setor"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-11 w-[280px] max-w-full rounded-full border border-[#E4E0F3] bg-white/80 pl-10 pr-4 text-sm outline-none focus:border-[#6D5BD0]"
                />
              </div>
            )}
            <ImportEmployees workloads={workloads} onDone={onChange} />
            <Button data-testid="btn-new-employee" onClick={() => setAdding(true)} className="h-11 rounded-full bg-[#6D5BD0] px-[18px] text-white hover:bg-[#5B4BC4]">
              <Plus className="mr-2 h-4 w-4" /> Novo funcionário
            </Button>
          </>
        }
      >
        Sua <em>equipe</em>
      </PageTitle>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {STATS.map((s) => {
          const n = employees.filter(s.test).length;
          return (
            <Stat
              key={s.id}
              label={s.label}
              value={n}
              active={statFilter === s.id}
              onClick={() => setStatFilter(statFilter === s.id ? null : s.id)}
              tone={s.risk ? (n ? "bg-[#FDE2E2] border-[#EE9A9A] text-[#A12828]" : "bg-[#E3F5EC] border-[#8FD0AE] text-[#1D6B45]") : ""}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Setor">
        {["all", ...[...sectors].sort((a, b) => a.localeCompare(b, "pt-BR"))].map((s) => (
          <button
            key={s}
            onClick={() => setSector(s)}
            className={`h-[38px] rounded-full border px-4 text-sm font-medium ${sector === s ? "border-[#17142E] bg-[#17142E] text-white" : "border-[#E4E0F3] bg-white/75 text-[#3A3555] hover:border-[#17142E]"}`}
          >
            {s === "all" ? "Todos" : s} <span className="opacity-60">{s === "all" ? employees.length : employees.filter((e) => e.sector === s).length}</span>
          </button>
        ))}
        {statFilter && (
          <button onClick={() => setStatFilter(null)} className="h-[38px] rounded-full border border-dashed border-[#B9B2DA] px-4 text-sm font-medium text-[#4B3DA8]">
            Mostrando: {STATS.find((s) => s.id === statFilter).label} · limpar
          </button>
        )}
      </div>

      <ul data-testid="employee-list" className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {employees.length === 0 && <li className="glass rounded-[26px] p-8 text-center text-sm text-[#5E5880] md:col-span-2 2xl:col-span-3">Nenhum funcionário cadastrado. Clique em <b>Novo funcionário</b> ou importe do ponto.</li>}
        {employees.length > 0 && list.length === 0 && <li className="glass rounded-[26px] p-8 text-center text-sm text-[#5E5880] md:col-span-2 2xl:col-span-3">Ninguém encontrado com esses filtros.</li>}
        {list.map((e) => {
          const v = current(e);
          const streak = streakDays(e);
          const risk = streak.length > 0 || noOff(e);
          const wl = workloads.find((w) => w.id === e.workload);
          const [label, value, bad] = footer(e);
          const sick = v?.kind === "atestado" || e.status === "atestado";
          const avatar = risk ? RISK : sick ? "bg-[#E8EEF7] text-[#34507A]" : v || e.status === "ferias" ? "bg-[#E6F2F1] text-[#2E5F5B]" : "bg-[#E6E1FA] text-[#4B3DA8]";
          return (
            <li
              key={e.id}
              data-testid={`employee-item-${e.id}`}
              className={`flex flex-col rounded-[26px] border p-5 shadow-[0_10px_30px_-20px_rgba(70,50,160,0.25)] ${risk ? "border-[#EE9A9A] bg-[#FDE2E2]/80" : "border-white bg-white/80"} ${e.status === "inativo" ? "opacity-55" : ""}`}
            >
              <div className="flex items-start gap-3.5">
                <span className={`grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl text-base font-bold ${avatar}`}>{initials(e.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[17px] font-semibold leading-tight">
                    {e.name}
                    {isTrial(e) && <span className="rounded bg-[#FFF4D1] px-1.5 py-0.5 text-[9px] font-bold text-[#7A5500]">TESTE</span>}
                  </p>
                  <p className="mt-0.5 text-[13px] text-[#5E5880]">{e.role} · {e.sector}</p>
                </div>
                <button onClick={() => setEditFor(e)} aria-label={`Opções de ${e.name}`} title="Editar" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#E4E0F3] bg-white text-[#3A3555] hover:border-[#17142E]">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {e.status === "inativo" ? (
                  <Chip className="bg-[#F2F0F8] text-[#5E5880]">Inativo</Chip>
                ) : v ? (
                  <Chip className={sick ? "bg-[#E8EEF7] text-[#34507A]" : "bg-[#E6F2F1] text-[#2E5F5B]"}>
                    <i className={`h-1.5 w-1.5 rounded-full ${sick ? "bg-[#34507A]" : "bg-[#2E5F5B]"}`} />{sick ? "Atestado" : "Férias"} até {fmtDate(v.end).slice(0, 5)}
                  </Chip>
                ) : (
                  <Chip className={OK}><i className="h-1.5 w-1.5 rounded-full bg-[#2E9E66]" />{fem(e) ? "Ativa" : "Ativo"}</Chip>
                )}
                <Chip className={isIntermittent(e) ? "bg-[#E0F2FE] text-[#0369A1]" : "bg-[#EEEBFB] text-[#4B3DA8]"}>
                  {isIntermittent(e) ? "Intermitente" : fem(e) ? "Efetiva" : "Efetivo"}
                </Chip>
                {wl ? <Chip className="bg-[#F2F0F8] text-[#3A3555]">{wl.name}</Chip> : <Chip className={WARN} title="Informe a jornada">Sem jornada</Chip>}
                {!e.gender && <Chip className={WARN} title="Informe o sexo para a regra de domingos da CCT">Sexo?</Chip>}
                {streak.length > 0 && <Chip className="bg-white/70 text-[#A12828]">Risco · +6 DIAS {streak.map((d) => `no ${DAYS_SHORT[d].toLowerCase()} ${dates[d] ? dates[d].getDate() : ""}`).join(", ")}</Chip>}
                {upcoming(e).filter((x) => x !== v).map((x) => (
                  <button key={x.id} onClick={() => openLeave(e, x.kind || "ferias")} className="inline-flex h-6 items-center rounded-full bg-[#F2F0F8] px-2.5 text-xs font-semibold text-[#5E5880] hover:bg-[#EEEBFB]">
                    {x.kind === "atestado" ? "Atestado" : "Férias"} {fmtDate(x.start).slice(0, 5)}–{fmtDate(x.end).slice(0, 5)}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <div className={`mt-4 flex items-center justify-between border-t pt-3 text-[13px] ${risk ? "border-[#EE9A9A]/60" : "border-[#EEEBFB]"}`}>
                <span className="text-[#5E5880]">{label}</span>
                <b className={`font-semibold ${bad ? "text-[#A12828]" : "text-[#1B1830]"}`}>{value}</b>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Novo funcionário</DialogTitle>
            <DialogDescription>Depois de adicionar, clique em Gerar escala para recalcular as folgas.</DialogDescription>
          </DialogHeader>
          <EmployeeForm sectors={sectors} roles={roles} workloads={workloads} onSaved={() => { setAdding(false); onChange(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="sm:max-w-[540px]">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{editing.name}</DialogTitle>
                <DialogDescription>{editing.role} · {editing.sector}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs font-semibold text-[#5E5880]">
                  <span>Status</span>
                  <select
                    aria-label="Status"
                    value={editing.status || "ativo"}
                    onChange={(evt) =>
                      evt.target.value === "ferias" || evt.target.value === "atestado"
                        ? openLeave(editing, evt.target.value) // Férias e atestado: abre a janela para informar o período
                        : update(editing, { status: evt.target.value }, `Status de ${editing.name} atualizado para ${evt.target.value}`)
                    }
                    className={field}
                  >
                    <option value="ativo">Ativo</option>
                    <option value="ferias">{editing.status === "ferias" ? "Férias (semana toda)" : "Férias…"}</option>
                    <option value="atestado">Atestado…</option>
                    {editing.status === "suspensao" && <option value="suspensao">Suspensão</option>}
                    {editing.status === "falta" && <option value="falta">Falta</option>}
                    <option value="inativo">Inativo</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs font-semibold text-[#5E5880]">
                  <span>Contrato</span>
                  <select aria-label="Contrato" value={editing.contract || "efetivo"} onChange={(evt) => update(editing, { contract: evt.target.value }, `Contrato de ${editing.name} atualizado`)} className={field}>
                    <option value="efetivo">Efetivo</option>
                    <option value="intermitente">Intermitente</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs font-semibold text-[#5E5880]">
                  <span>Jornada</span>
                  <select aria-label="Jornada" value={editing.workload || ""} onChange={(evt) => update(editing, { workload: evt.target.value || null }, `Jornada de ${editing.name} atualizada`)} className={`${field} ${!editing.workload ? "border-[#F2CF6B] bg-[#FFF9E6]" : ""}`}>
                    <option value="">Jornada?</option>
                    {workloads.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-semibold text-[#5E5880]">
                  <span>Sexo (domingos da CCT)</span>
                  <select aria-label="Sexo" value={editing.gender || ""} onChange={(evt) => update(editing, { gender: evt.target.value || null }, `Sexo de ${editing.name} atualizado`)} className={`${field} ${!editing.gender ? "border-[#F2CF6B] bg-[#FFF9E6]" : ""}`}>
                    <option value="">Sexo?</option>
                    <option value="M">Masculino</option>
                    <option value="F">Feminino</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <div className="flex flex-wrap gap-2">
                  {isTrial(editing) ? (
                    <Button data-testid={`btn-approve-${editing.id}`} variant="outline" onClick={() => setRoleFor(editing)} className="rounded-full border-[#8FD0AE] text-[#1D6B45]">
                      <BadgeCheck className="mr-1.5 h-4 w-4" /> Aprovar
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setRoleFor(editing)} className="rounded-full">
                      <Pencil className="mr-1.5 h-4 w-4" /> Trocar cargo e setor
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => openLeave(editing, "ferias")} className="rounded-full">Férias</Button>
                  <Button variant="outline" onClick={() => openLeave(editing, "atestado")} className="rounded-full">Atestado</Button>
                </div>
                <Button data-testid={`btn-delete-employee-${editing.id}`} variant="outline" onClick={() => remove(editing)} className="rounded-full text-[#A12828] hover:bg-[#FDECEC]">
                  <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <RoleDialog
        employee={roleFor}
        employees={employees}
        onClose={() => setRoleFor(null)}
        onSave={(emp, patch) =>
          update(emp, patch, isTrial(emp) ? `${emp.name} aprovado: ${patch.role} · ${patch.sector}` : `${emp.name}: ${patch.role} · ${patch.sector}`)
        }
      />
      <VacationDialog kind={leaveKind} employee={vacationFor} vacations={vacations} onClose={() => setVacationFor(null)} onSaved={onChange} />
    </section>
  );
};

import { useState } from "react";
import { Plus, Trash2, Loader2, Search, Pencil, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg, isoDate } from "@/lib/api";
import { ImportEmployees } from "@/components/folga/ImportEmployees";
import { VacationDialog, fmtDate } from "@/components/folga/VacationDialog";
import { RoleDialog, isTrial } from "@/components/folga/RoleDialog";

// Comparação sem acento e sem diferenciar maiúsculas
const fold = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const EMPTY = { name: "", role: "", sector: "", status: "ativo", gender: "", workload: "", contract: "efetivo" };
const selectCls = "text-xs bg-[#F8F6F0] border border-[#E5E1D8] rounded-lg px-2 py-1.5 text-[#575E65] font-medium outline-none focus:border-[#0F172A] transition-colors";

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
      <Button data-testid="btn-save-employee" type="submit" disabled={busy} className="sm:col-span-2 bg-[#0F172A] hover:bg-[#1E293B] text-white">
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} Adicionar funcionário
      </Button>
    </form>
  );
};

export const EmployeesPanel = ({ employees, workloads = [], vacations = [], onChange }) => {
  const sectors = [...new Set(employees.map((e) => e.sector))];
  const roles = [...new Set(employees.map((e) => e.role))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const [roleFor, setRoleFor] = useState(null);
  const [vacationFor, setVacationFor] = useState(null);
  const [leaveKind, setLeaveKind] = useState("ferias");
  const openLeave = (emp, kind) => { setLeaveKind(kind); setVacationFor(emp); };
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const list = employees
    .filter((e) => !q || fold(`${e.name} ${e.role} ${e.sector}`).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  const today = isoDate(new Date());
  // Férias em andamento ou futuras, para mostrar embaixo do nome
  const upcoming = (emp) => vacations.filter((v) => v.employee_id === emp.id && v.end >= today);

  const remove = async (emp) => {
    try {
      await http.delete(`/employees/${emp.id}`);
      toast.success(`${emp.name} removido`);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Atualiza status (Ativo / Férias / Suspensão) ou sexo, sempre enviando todos os campos
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

  return (
    <section data-testid="employees-panel" className="rounded-2xl border border-[#E5E1D8] bg-white p-5 sm:p-6 h-full">
      <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Equipe</p>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1 mb-4">
        <h3 className="font-display text-2xl font-bold tracking-tight">Funcionários</h3>
        <ImportEmployees workloads={workloads} onDone={onChange} />
      </div>
      <EmployeeForm sectors={sectors} roles={roles} workloads={workloads} onSaved={onChange} />
      {employees.length > 0 && (
        <div className="relative mt-5">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8A929B]" />
          <Input
            data-testid="input-employee-search"
            placeholder={`Procurar entre ${employees.length} funcionários (nome, cargo ou setor)`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      )}
      <ul data-testid="employee-list" className="mt-2 divide-y divide-[#EFEBE3] max-h-96 overflow-y-auto">
        {employees.length === 0 && <li className="py-6 text-sm text-center text-[#8A929B]">Nenhum funcionário cadastrado.</li>}
        {employees.length > 0 && list.length === 0 && <li className="py-6 text-sm text-center text-[#8A929B]">Nenhum funcionário encontrado para "{query}".</li>}
        {list.map((e) => (
          <li key={e.id} data-testid={`employee-item-${e.id}`} className={`py-2.5 flex items-center justify-between gap-3 ${e.status === "inativo" ? "opacity-50" : ""}`}>
            <div className="min-w-[140px] flex-1">
              <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                {e.name}
                {isTrial(e) && <span className="text-[9px] bg-[#FEF3C7] text-[#B45309] font-bold px-1.5 py-0.5 rounded">TESTE</span>}
              </p>
              <p className="text-xs text-[#8A929B] flex items-center gap-1 min-w-0">
                <span className="truncate">{e.role} · <span className="text-[#575E65]">{e.sector}</span></span>
                {isTrial(e) ? (
                  <button
                    data-testid={`btn-approve-${e.id}`}
                    onClick={() => setRoleFor(e)}
                    className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#15803D] bg-[#F0FDF4] border border-[#BBF7D0] rounded px-1.5 py-0.5 hover:bg-[#DCFCE7]"
                  >
                    <BadgeCheck className="h-3 w-3" /> Aprovar
                  </button>
                ) : (
                  <button onClick={() => setRoleFor(e)} aria-label={`Trocar cargo e setor de ${e.name}`} title="Trocar cargo e setor" className="shrink-0 p-0.5 rounded text-[#B8B2A7] hover:text-[#0F172A]">
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </p>
              {upcoming(e).map((v) => (
                <button
                  key={v.id}
                  onClick={() => openLeave(e, v.kind || "ferias")}
                  className={`block text-[10px] font-semibold rounded px-1.5 py-0.5 mt-0.5 ${
                    v.kind === "atestado" ? "text-[#0F766E] bg-[#F0FDFA] hover:bg-[#CCFBF1]" : "text-[#475569] bg-[#F1F5F9] hover:bg-[#E2E8F0]"
                  }`}
                >
                  {v.kind === "atestado" ? "Atestado" : "Férias"} {fmtDate(v.start)} a {fmtDate(v.end)}
                </button>
              ))}
            </div>
            
            <select
              aria-label="Sexo"
              value={e.gender || ""}
              onChange={(evt) => update(e, { gender: evt.target.value || null }, `Sexo de ${e.name} atualizado`)}
              className={`${selectCls} ${!e.gender ? "border-[#FCD34D] bg-[#FFFBEB]" : ""}`}
              title={!e.gender ? "Informe o sexo para aplicar a regra de domingos da CCT" : undefined}
            >
              <option value="">Sexo?</option>
              <option value="M">Masc.</option>
              <option value="F">Fem.</option>
            </select>

            <select
              aria-label="Jornada"
              value={e.workload || ""}
              onChange={(evt) => update(e, { workload: evt.target.value || null }, `Jornada de ${e.name} atualizada`)}
              className={`${selectCls} ${!e.workload ? "border-[#FCD34D] bg-[#FFFBEB]" : ""}`}
              title={workloads.find((w) => w.id === e.workload)?.name || "Informe a jornada"}
            >
              <option value="">Jornada?</option>
              {workloads.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>

            <select
              aria-label="Contrato"
              value={e.contract || "efetivo"}
              onChange={(evt) => update(e, { contract: evt.target.value }, `Contrato de ${e.name} atualizado`)}
              className={selectCls}
            >
              <option value="efetivo">Efetivo</option>
              <option value="intermitente">Interm.</option>
            </select>

            <select
              aria-label="Status"
              value={e.status || "ativo"}
              onChange={(evt) =>
                evt.target.value === "ferias" || evt.target.value === "atestado"
                  ? openLeave(e, evt.target.value) // Férias e atestado: abre a janela para informar o período
                  : update(e, { status: evt.target.value }, `Status de ${e.name} atualizado para ${evt.target.value}`)
              }
              className={selectCls}
            >
              <option value="ativo">Ativo</option>
              <option value="ferias">{e.status === "ferias" ? "Férias (semana toda)" : "Férias…"}</option>
              <option value="atestado">Atestado…</option>
              {/* Suspensão e falta agora são marcadas direto na escala; opções só para cadastros antigos */}
              {e.status === "suspensao" && <option value="suspensao">Suspensão</option>}
              {e.status === "falta" && <option value="falta">Falta</option>}
              <option value="inativo">Inativo</option>
            </select>

            <button data-testid={`btn-delete-employee-${e.id}`} onClick={() => remove(e)} className="p-2 rounded-lg text-[#8A929B] hover:bg-[#FEF2F2] hover:text-[#DC2626] transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
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

import { useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg } from "@/lib/api";
import { ImportEmployees } from "@/components/folga/ImportEmployees";

const EMPTY = { name: "", role: "", sector: "", status: "ativo", gender: "", workload: "" };
const selectCls = "text-xs bg-[#F8F6F0] border border-[#E5E1D8] rounded-lg px-2 py-1.5 text-[#575E65] font-medium outline-none focus:border-[#0F172A] transition-colors";

const EmployeeForm = ({ sectors, workloads, onSaved }) => {
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
        workload: form.workload
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
      <Input data-testid="input-employee-role" placeholder="Cargo" value={form.role} onChange={set("role")} />
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
      <datalist id="sectors">{sectors.map((s) => <option key={s} value={s} />)}</datalist>
      <Button data-testid="btn-save-employee" type="submit" disabled={busy} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} Adicionar funcionário
      </Button>
    </form>
  );
};

export const EmployeesPanel = ({ employees, workloads = [], onChange }) => {
  const sectors = [...new Set(employees.map((e) => e.sector))];

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
      <EmployeeForm sectors={sectors} workloads={workloads} onSaved={onChange} />
      <ul data-testid="employee-list" className="mt-5 divide-y divide-[#EFEBE3] max-h-72 overflow-y-auto">
        {employees.length === 0 && <li className="py-6 text-sm text-center text-[#8A929B]">Nenhum funcionário cadastrado.</li>}
        {employees.map((e) => (
          <li key={e.id} data-testid={`employee-item-${e.id}`} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{e.name}</p>
              <p className="text-xs text-[#8A929B] truncate">{e.role} · <span className="text-[#575E65]">{e.sector}</span></p>
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
              aria-label="Status"
              value={e.status || "ativo"}
              onChange={(evt) => update(e, { status: evt.target.value }, `Status de ${e.name} atualizado para ${evt.target.value}`)}
              className={selectCls}
            >
              <option value="ativo">Ativo</option>
              <option value="ferias">Férias</option>
              <option value="suspensao">Suspensão</option>
              <option value="falta">Falta</option>
            </select>

            <button data-testid={`btn-delete-employee-${e.id}`} onClick={() => remove(e)} className="p-2 rounded-lg text-[#8A929B] hover:bg-[#FEF2F2] hover:text-[#DC2626] transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

import { useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg } from "@/lib/api";

const EMPTY = { name: "", role: "", sector: "" };

const EmployeeForm = ({ sectors, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.role.trim() || !form.sector.trim()) return toast.error("Preencha nome, cargo e setor.");
    setBusy(true);
    try {
      await http.post("/employees", { name: form.name.trim(), role: form.role.trim(), sector: form.sector.trim() });
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
      <datalist id="sectors">{sectors.map((s) => <option key={s} value={s} />)}</datalist>
      <Button data-testid="btn-save-employee" type="submit" disabled={busy} className="sm:col-span-3 bg-[#0F172A] hover:bg-[#1E293B] text-white">
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} Adicionar funcionário
      </Button>
    </form>
  );
};

export const EmployeesPanel = ({ employees, onChange }) => {
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

  return (
    <section data-testid="employees-panel" className="rounded-2xl border border-[#E5E1D8] bg-white p-5 sm:p-6 h-full">
      <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Equipe</p>
      <h3 className="font-display text-2xl font-bold tracking-tight mt-1 mb-4">Funcionários</h3>
      <EmployeeForm sectors={sectors} onSaved={onChange} />
      <ul data-testid="employee-list" className="mt-5 divide-y divide-[#EFEBE3] max-h-72 overflow-y-auto">
        {employees.length === 0 && <li className="py-6 text-sm text-center text-[#8A929B]">Nenhum funcionário cadastrado.</li>}
        {employees.map((e) => (
          <li key={e.id} data-testid={`employee-item-${e.id}`} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{e.name}</p>
              <p className="text-xs text-[#8A929B] truncate">{e.role} · <span className="text-[#575E65]">{e.sector}</span></p>
            </div>
            <button data-testid={`btn-delete-employee-${e.id}`} onClick={() => remove(e)} className="p-2 rounded-lg text-[#8A929B] hover:bg-[#FEF2F2] hover:text-[#DC2626] transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const isTrial = (emp) => /teste/i.test(emp?.role || "");

const sorted = (items) => [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));

// Troca de cargo e setor; para quem está em teste, é a aprovação
export const RoleDialog = ({ employee, employees, onClose, onSave }) => {
  const [role, setRole] = useState("");
  const [sector, setSector] = useState("");
  const [busy, setBusy] = useState(false);
  const trial = isTrial(employee);

  useEffect(() => {
    if (!employee) return;
    setRole(trial ? "" : employee.role);
    setSector(employee.sector);
  }, [employee, trial]);

  // Só cargos e setores já cadastrados (o cargo de teste não aparece como destino)
  const roles = sorted(employees.map((e) => e.role).filter((r) => !/teste/i.test(r)));
  const sectors = sorted(employees.map((e) => e.sector));

  const save = async () => {
    setBusy(true);
    try {
      await onSave(employee, { role, sector });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const selectCls = "w-full rounded-md border border-[#E5E1D8] bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F172A]";

  return (
    <Dialog open={!!employee} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="role-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{trial ? "Aprovar" : "Cargo e setor"} · {employee?.name}</DialogTitle>
          <DialogDescription>
            {trial
              ? `Em teste como "${employee?.role}". Escolha o cargo e o setor em que vai ficar.`
              : "Escolha entre os cargos e setores já cadastrados."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-[#575E65] space-y-1">
            <span>Cargo</span>
            <select data-testid="select-new-role" value={role} onChange={(e) => setRole(e.target.value)} className={selectCls}>
              <option value="">Escolha…</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#575E65] space-y-1">
            <span>Setor</span>
            <select data-testid="select-new-sector" value={sector} onChange={(e) => setSector(e.target.value)} className={selectCls}>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {employee && sector !== employee.sector && (
          <p className="text-xs text-[#B45309]">
            Mudando de setor: gere a escala de {sector} (e de {employee.sector}) para recalcular as folgas desta semana.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            data-testid="btn-save-role"
            disabled={busy || !role || !sector || (role === employee?.role && sector === employee?.sector)}
            onClick={save}
            className="bg-[#0F172A] hover:bg-[#1E293B] text-white"
          >
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} {trial ? "Aprovar" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

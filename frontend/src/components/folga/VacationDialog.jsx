import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { http, errMsg } from "@/lib/api";

export const fmtDate = (iso) => iso.split("-").reverse().join("/");

// Janela para informar o período de férias ou atestado; só esses dias mudam na escala
export const VacationDialog = ({ kind = "ferias", employee, vacations, onClose, onSaved }) => {
  const sick = kind === "atestado";
  const noun = sick ? "atestado" : "férias";
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStart(""); setEnd(""); }, [employee]);

  const mine = employee ? vacations.filter((v) => v.employee_id === employee.id && (v.kind || "ferias") === kind) : [];

  const save = async () => {
    if (!start || !end) return toast.error(`Informe o início e o fim ${sick ? "do atestado" : "das férias"}.`);
    if (end < start) return toast.error(`O fim ${sick ? "do atestado" : "das férias"} precisa ser depois do início.`);
    setBusy(true);
    try {
      await http.post("/vacations", { employee_id: employee.id, start, end, kind });
      // Quem estava com o status antigo "Férias" (a semana toda) volta a ativo: agora vale só o período
      if (!sick && employee.status === "ferias") {
        await http.put(`/employees/${employee.id}`, {
          name: employee.name, role: employee.role, sector: employee.sector,
          status: "ativo", gender: employee.gender || null, workload: employee.workload || null,
          contract: employee.contract || null,
        });
      }
      toast.success(`${sick ? "Atestado" : "Férias"} de ${employee.name}: ${fmtDate(start)} a ${fmtDate(end)}`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v) => {
    try {
      await http.delete(`/vacations/${v.id}`);
      toast.success(`Período de ${noun} removido`);
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const inputCls = "w-full rounded-md border border-[#E5E1D8] bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F172A]";

  return (
    <Dialog open={!!employee} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="vacation-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{sick ? "Atestado" : "Férias"} · {employee?.name}</DialogTitle>
          <DialogDescription>
            Informe o período. Só esses dias ficam como {sick ? "atestado" : "férias"} na escala.
            {sick && " Pode ser lançado também em dias que já passaram."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-[#575E65] space-y-1">
            <span>Início</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs font-semibold text-[#575E65] space-y-1">
            <span>Fim</span>
            <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </label>
        </div>
        {mine.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[#575E65] mb-1">Períodos cadastrados</p>
            <ul className="divide-y divide-[#EFEBE3] text-sm">
              {mine.map((v) => (
                <li key={v.id} className="py-1.5 flex items-center justify-between">
                  <span>{fmtDate(v.start)} a {fmtDate(v.end)}</span>
                  <button onClick={() => remove(v)} aria-label="Remover período" className="p-1.5 rounded-lg text-[#8A929B] hover:bg-[#FEF2F2] hover:text-[#DC2626]">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy} onClick={save} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

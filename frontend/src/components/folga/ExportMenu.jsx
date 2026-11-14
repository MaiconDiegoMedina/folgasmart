import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DAYS, downloadFile, weekDates, fmtDayMonth } from "@/lib/api";
import { toast } from "sonner";
import { isIntermittent, convocationOf } from "@/lib/convocation";

const buildCsv = (employees, schedule) => {
  const dates = weekDates(schedule.week);
  const header = ["Setor", "Funcionário", "Cargo", ...DAYS.map((d, i) => `${d} ${fmtDayMonth(dates[i])}`)].join(";");
  const sorted = [...employees].sort((a, b) => a.sector.localeCompare(b.sector));
  const off = (e, i) => (schedule.off_days?.[e.id] || []).includes(i);
  const extra = (e, i) => (schedule.extra_days?.[e.id] || []).includes(i);
  const susp = (e, i) => (schedule.suspension_days?.[e.id] || []).includes(i);
  const absent = (e, i) => (schedule.absence_days?.[e.id] || []).includes(i);
  const vacation = (e, i) => e.status === "ferias" || (schedule.vacation_days?.[e.id] || []).includes(i);
  const intermittentLabel = (e, i) => {
    const st = convocationOf(schedule, e.id, i)?.status;
    return st === "accepted" ? "TRABALHA" : st === "pending" ? "CONVOCADO" : st === "declined" ? "RECUSOU" : "-";
  };
  const label = (e, i) => (vacation(e, i) ? "FÉRIAS" : isIntermittent(e) ? intermittentLabel(e, i) : absent(e, i) ? "FALTA" : susp(e, i) ? "SUSPENSÃO" : extra(e, i) ? "EXTRA" : off(e, i) ? "FOLGA" : "TRABALHA");
  const rows = sorted.map((e) => [e.sector, e.name, e.role, ...DAYS.map((_, i) => label(e, i))].join(";"));
  const coverage = DAYS.map((_, i) => employees.filter((e) => label(e, i) === "TRABALHA" || label(e, i) === "EXTRA").length);
  return [header, ...rows, ["Em operação", "", "", ...coverage].join(";")].join("\n");
};

export const ExportMenu = ({ employees, schedule }) => {
  const exportCsv = () => {
    if (!employees.length) return toast.error("Nenhum funcionário para exportar.");
    downloadFile(`escala-${schedule.week}-${schedule.mode}.csv`, buildCsv(employees, schedule));
    toast.success("Escala exportada em CSV");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="btn-export-schedule" variant="outline" className="rounded-full border-[#D1CBBF] bg-white hover:bg-[#0F172A] hover:text-white">
          <Download className="h-4 w-4 mr-2" /> Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-testid="export-modal" align="end">
        <DropdownMenuItem data-testid="btn-download-csv" onClick={exportCsv}>
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Baixar CSV (Excel)
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="btn-print-schedule" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" /> Imprimir / Salvar PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

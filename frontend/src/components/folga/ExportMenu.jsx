import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DAYS, downloadFile } from "@/lib/api";
import { toast } from "sonner";

const buildCsv = (employees, schedule) => {
  const header = ["Funcionário", "Cargo", "Setor", ...DAYS].join(";");
  const rows = employees.map((e) => {
    const off = schedule.off_days[e.id] || [];
    return [e.name, e.role, e.sector, ...DAYS.map((_, i) => (off.includes(i) ? "FOLGA" : "TRABALHA"))].join(";");
  });
  const coverage = DAYS.map((_, i) => employees.filter((e) => !(schedule.off_days[e.id] || []).includes(i)).length);
  return [header, ...rows, ["Em operação", "", "", ...coverage].join(";")].join("\n");
};

export const ExportMenu = ({ employees, schedule }) => {
  const exportCsv = () => {
    if (!employees.length) return toast.error("Nenhum funcionário para exportar.");
    downloadFile(`escala-${schedule.mode}.csv`, buildCsv(employees, schedule));
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

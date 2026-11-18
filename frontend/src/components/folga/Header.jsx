import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/folga/ExportMenu";
import { DAYS_SHORT } from "@/lib/api";

// Título de cada aba: linha pequena em cima e título com serifa
export const PageTitle = ({ eyebrow, children, actions }) => (
  <header className="no-print flex flex-wrap items-end justify-between gap-4">
    <div>
      {eyebrow && <p className="mb-2 text-[13px] font-medium text-[#5E5880]">{eyebrow}</p>}
      <h1 className="font-serif-title text-[40px] leading-none sm:text-[56px]">{children}</h1>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
  </header>
);

export const Header = ({ employees, movement, schedule, generating, onGenerate, generateSector }) => {
  const peaks = movement?.peak_days || [];
  return (
    <PageTitle
      eyebrow={
        <span data-testid="app-header">
          <span data-testid="stat-employees">{employees.length} funcionários</span>
          {peaks.length > 0 && <> · pico: <span className="font-semibold text-[#7A5500]">{peaks.map((d) => DAYS_SHORT[d]).join(", ")}</span></>}
        </span>
      }
      actions={
        <>
          <ExportMenu employees={employees} schedule={schedule} />
          <Button
            data-testid="btn-generate-roster"
            onClick={() => onGenerate()}
            disabled={generating}
            className="h-11 rounded-full bg-[#6D5BD0] px-5 text-white hover:bg-[#5B4BC4]"
          >
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generateSector ? `Gerar escala · ${generateSector}` : "Gerar escala · todos"}
          </Button>
        </>
      }
    >
      Quem trabalha, <em>quem folga</em>
    </PageTitle>
  );
};

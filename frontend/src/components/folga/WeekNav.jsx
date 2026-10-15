import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, isoDate, mondayOf, parseIso, fmtWeekRange } from "@/lib/api";

export const WeekNav = ({ week, onChange }) => {
  const current = isoDate(mondayOf(new Date()));
  const shift = (n) => onChange(isoDate(addDays(parseIso(week), n * 7)));
  const btn = "h-9 w-9 grid place-items-center rounded-full border border-[#D1CBBF] bg-white text-[#575E65] hover:bg-[#0F172A] hover:text-white transition-colors";
  return (
    <div data-testid="week-nav" className="flex items-center gap-2">
      <button data-testid="btn-prev-week" onClick={() => shift(-1)} className={`${btn} no-print`} title="Semana anterior">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span data-testid="week-range" className="font-mono-data text-sm font-semibold min-w-[170px] text-center">{fmtWeekRange(week)}</span>
      <button data-testid="btn-next-week" onClick={() => shift(1)} className={`${btn} no-print`} title="Próxima semana">
        <ChevronRight className="h-4 w-4" />
      </button>
      {week !== current && (
        <button data-testid="btn-current-week" onClick={() => onChange(current)} className="no-print px-3 h-9 rounded-full text-xs font-semibold border border-[#0F172A] text-[#0F172A] hover:bg-[#0F172A] hover:text-white transition-colors">
          Semana atual
        </button>
      )}
    </div>
  );
};

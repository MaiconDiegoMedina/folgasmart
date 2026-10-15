import { CalendarRange, Sparkles, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/folga/ExportMenu";
import { DAYS_SHORT, http } from "@/lib/api";

const UserMenu = ({ user }) => {
  const logout = async () => {
    await http.post("/auth/logout").catch(() => {});
    window.location.href = "/login";
  };
  return (
    <div data-testid="user-menu" className="flex items-center gap-2 pl-3 border-l border-[#E5E1D8]">
      {user?.picture ? (
        <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" />
      ) : (
        <span className="h-8 w-8 rounded-full bg-[#0F172A] text-white grid place-items-center text-xs font-bold">{user?.name?.[0]}</span>
      )}
      <span data-testid="user-name" className="hidden lg:block text-sm font-semibold max-w-[140px] truncate">{user?.name}</span>
      <button data-testid="btn-logout" onClick={logout} title="Sair" className="p-2 rounded-lg text-[#575E65] hover:bg-[#0F172A] hover:text-white transition-colors">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
};

const ModeToggle = ({ mode, onChange, disabled }) => (
  <div data-testid="scale-mode-toggle" className="inline-flex rounded-full border border-[#D1CBBF] bg-white p-1">
    {["6x1", "5x2"].map((m) => (
      <button
        key={m}
        disabled={disabled}
        data-testid={`scale-mode-${m}`}
        onClick={() => m !== mode && onChange(m)}
        className={`px-4 py-1.5 rounded-full text-sm font-semibold font-mono-data transition-colors duration-200 ${
          m === mode ? "bg-[#0F172A] text-white" : "text-[#575E65] hover:bg-[#F2EFE8] hover:text-[#191C1E]"
        }`}
      >
        {m}
      </button>
    ))}
  </div>
);

export const Header = ({ user, employees, movement, schedule, generating, onGenerate, onModeChange }) => {
  const peaks = movement?.peak_days || [];
  return (
    <header data-testid="app-header" className="no-print md:sticky top-0 z-30 border-b border-[#E5E1D8] bg-[#F9F8F5]/85 backdrop-blur-xl">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#0F172A] text-white grid place-items-center">
            <CalendarRange className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight leading-none">FolgaSmart</h1>
            <p className="text-xs text-[#575E65] mt-1">
              <span data-testid="stat-employees">{employees.length} funcionários</span>
              {peaks.length > 0 && <> · pico: <span className="text-[#DC2626] font-semibold">{peaks.map((d) => DAYS_SHORT[d]).join(", ")}</span></>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ModeToggle mode={schedule.mode} onChange={onModeChange} disabled={generating || !employees.length} />
          <ExportMenu employees={employees} schedule={schedule} />
          <Button
            data-testid="btn-generate-roster"
            onClick={() => onGenerate()}
            disabled={generating}
            className="rounded-full bg-[#DC2626] hover:bg-[#B91C1C] text-white px-5"
          >
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Gerar escala
          </Button>
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
};

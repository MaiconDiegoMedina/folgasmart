import { Home, CalendarDays, Users, BarChart3, ShoppingCart, Settings, LogOut } from "lucide-react";
import { SECTOR_TABS } from "@/components/folga/SectorBoard";

export const TABS = [
  { id: "inicio", label: "Início", icon: Home },
  { id: "escala", label: "Escala", icon: CalendarDays },
  { id: "funcionarios", label: "Funcionários", icon: Users },
  { id: "movimento", label: "Movimento de clientes", short: "Movimento", icon: BarChart3 },
  { id: "caixas", label: "Caixas", icon: ShoppingCart },
  ...SECTOR_TABS.map(({ id, label, short, icon }) => ({ id, label, short, icon })),
  { id: "configuracoes", label: "Configurações", short: "Config.", icon: Settings },
];

// Menu principal: barra escura à esquerda no computador e pílula embaixo no celular
export const AppRail = ({ tab, onTab, onLogout }) => (
  <>
    <nav aria-label="Menu principal" className="no-print hidden md:flex sticky top-6 z-20 w-[76px] shrink-0 flex-col items-center gap-1.5 self-start rounded-[38px] bg-[#17142E] py-[18px] min-h-[640px]">
      <div className="mb-3.5 grid h-11 w-11 place-items-center rounded-[14px] bg-white font-display text-[15px] font-bold text-[#17142E]">ES</div>
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id)}
          aria-label={t.label}
          title={t.label}
          aria-current={tab === t.id ? "page" : undefined}
          className={`grid h-11 w-11 place-items-center rounded-2xl transition-colors ${tab === t.id ? "bg-[#7C6AE0] text-white" : "text-[#B7B1D6] hover:bg-white/10 hover:text-white"}`}
        >
          <t.icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
        </button>
      ))}
      <div className="flex-1 min-h-[40px]" />
      <button onClick={onLogout} aria-label="Sair" title="Sair" className="grid h-12 w-12 place-items-center rounded-2xl text-[#B7B1D6] hover:bg-white/10 hover:text-white">
        <LogOut className="h-[22px] w-[22px]" strokeWidth={1.8} />
      </button>
    </nav>
    <nav aria-label="Menu principal" className="no-print md:hidden fixed bottom-3 left-3 right-3 z-40 flex items-center justify-between gap-1 overflow-x-auto rounded-[28px] bg-[#17142E] px-2 py-2 shadow-[0_18px_40px_-16px_rgba(23,20,46,0.6)]">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id)}
          aria-label={t.label}
          aria-current={tab === t.id ? "page" : undefined}
          ref={tab === t.id ? (el) => el?.scrollIntoView({ inline: "nearest", block: "nearest" }) : undefined}
          className={`flex min-w-[44px] flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[10px] font-semibold ${tab === t.id ? "bg-[#7C6AE0] text-white" : "text-[#B7B1D6]"}`}
        >
          <t.icon className="h-5 w-5" strokeWidth={1.8} />
          <span className="truncate max-w-[60px]">{t.short || t.label}</span>
        </button>
      ))}
    </nav>
  </>
);

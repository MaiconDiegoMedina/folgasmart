import { useMemo } from "react";
import { Home, CalendarDays, Users, BarChart3, ShoppingCart, Settings, LogOut } from "lucide-react";
import { byUse, countSectorUse } from "@/lib/sectorIcons";

export const MAIN_TABS = [
  { id: "inicio", label: "Início", icon: Home },
  { id: "escala", label: "Escala", icon: CalendarDays },
  { id: "funcionarios", label: "Funcionários", icon: Users },
  { id: "movimento", label: "Movimento de clientes", short: "Movimento", icon: BarChart3 },
  { id: "caixas", label: "Caixas", icon: ShoppingCart },
];
export const SETTINGS_TAB = { id: "configuracoes", label: "Configurações", short: "Config.", icon: Settings };
export const TABS = [...MAIN_TABS, SETTINGS_TAB];

const railBtn = (active) =>
  `grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-colors ${active ? "bg-[#7C6AE0] text-white" : "text-[#B7B1D6] hover:bg-white/10 hover:text-white"}`;
const pillBtn = (active) =>
  `flex min-w-[44px] flex-1 shrink-0 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[10px] font-semibold ${active ? "bg-[#7C6AE0] text-white" : "text-[#B7B1D6]"}`;
// A aba aberta fica visível dentro da área com rolagem
const keepVisible = (active) => (active ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined);

// Menu principal: barra escura à esquerda no computador e pílula embaixo no celular.
// Setores: os mais abertos primeiro; no computador aparecem 3 e o resto fica na rolagem logo abaixo.
export const AppRail = ({ tab, onTab, onLogout, sectorTabs = [] }) => {
  // Ordem calculada quando a lista de setores muda (não pula enquanto a pessoa clica)
  const sectors = useMemo(() => byUse(sectorTabs), [sectorTabs]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (t, isSector) => {
    if (isSector) countSectorUse(t.id);
    onTab(t.id);
  };
  const railButton = (t, isSector = false) => (
    <button
      key={t.id}
      onClick={() => open(t, isSector)}
      aria-label={t.label}
      title={t.label}
      aria-current={tab === t.id ? "page" : undefined}
      ref={isSector ? keepVisible(tab === t.id) : undefined}
      className={railBtn(tab === t.id)}
    >
      <t.icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
    </button>
  );
  const pillButton = (t, isSector = false) => (
    <button
      key={t.id}
      onClick={() => open(t, isSector)}
      aria-label={t.label}
      aria-current={tab === t.id ? "page" : undefined}
      ref={keepVisible(tab === t.id)}
      className={pillBtn(tab === t.id)}
    >
      <t.icon className="h-5 w-5" strokeWidth={1.8} />
      <span className="truncate max-w-[60px]">{t.short || t.label}</span>
    </button>
  );

  return (
    <>
      <nav aria-label="Menu principal" className="no-print hidden md:flex sticky top-6 z-20 w-[76px] shrink-0 flex-col items-center gap-1.5 self-start rounded-[38px] bg-[#17142E] py-[18px] min-h-[640px]">
        <div className="mb-3.5 grid h-11 w-11 place-items-center rounded-[14px] bg-white font-display text-[15px] font-bold text-[#17142E]">ES</div>
        {MAIN_TABS.map((t) => railButton(t))}
        {sectors.length > 0 && (
          <>
            <div className="my-1.5 h-px w-8 bg-white/15" />
            <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7E78A3]">Setores</p>
            <div
              aria-label="Setores"
              className="rail-scroll flex max-h-[144px] w-full flex-col items-center gap-1.5 overflow-y-auto overscroll-contain"
            >
              {sectors.map((t) => railButton(t, true))}
            </div>
            {sectors.length > 3 && <p className="text-[9px] text-[#7E78A3]" aria-hidden="true">+{sectors.length - 3} ↓</p>}
            <div className="my-1.5 h-px w-8 bg-white/15" />
          </>
        )}
        {railButton(SETTINGS_TAB)}
        <div className="flex-1 min-h-[24px]" />
        <button onClick={onLogout} aria-label="Sair" title="Sair" className="grid h-12 w-12 place-items-center rounded-2xl text-[#B7B1D6] hover:bg-white/10 hover:text-white">
          <LogOut className="h-[22px] w-[22px]" strokeWidth={1.8} />
        </button>
      </nav>
      <nav aria-label="Menu principal" className="no-print md:hidden fixed bottom-3 left-3 right-3 z-40 flex items-center justify-between gap-1 overflow-x-auto rounded-[28px] bg-[#17142E] px-2 py-2 shadow-[0_18px_40px_-16px_rgba(23,20,46,0.6)]">
        {MAIN_TABS.map((t) => pillButton(t))}
        {sectors.map((t) => pillButton(t, true))}
        {pillButton(SETTINGS_TAB)}
      </nav>
    </>
  );
};

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarRange, Flame, Users, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { http } from "@/lib/api";

const FEATURES = [
  { icon: Users, text: "Organize a equipe por setor" },
  { icon: Flame, text: "Proteja os dias de maior movimento" },
  { icon: Download, text: "Exporte a escala 6x1 ou 5x2" },
];

export default function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    http.get("/auth/me").then(() => navigate("/", { replace: true })).catch(() => {});
  }, [navigate]);

  const login = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="grain min-h-screen bg-[#F9F8F5] text-[#191C1E] grid lg:grid-cols-2">
      <div className="relative z-10 flex flex-col justify-center px-6 sm:px-12 lg:px-20 py-16">
        <div className="flex items-center gap-3 mb-12 rise">
          <div className="h-11 w-11 rounded-xl bg-[#0F172A] text-white grid place-items-center">
            <CalendarRange className="h-5 w-5" />
          </div>
          <span className="font-display text-2xl font-extrabold tracking-tight">FolgaSmart</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.02] rise" style={{ animationDelay: "60ms" }}>
          Folgas certas.<br /><span className="text-[#DC2626]">Casa cheia coberta.</span>
        </h1>
        <p className="text-base text-[#575E65] mt-6 max-w-md rise" style={{ animationDelay: "120ms" }}>
          Cadastre sua equipe e deixe o app distribuir as folgas mantendo o máximo de gente trabalhando nos dias de pico.
        </p>
        <ul className="mt-8 space-y-3 rise" style={{ animationDelay: "180ms" }}>
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm font-medium">
              <span className="h-8 w-8 rounded-lg bg-white border border-[#E5E1D8] grid place-items-center"><Icon className="h-4 w-4 text-[#DC2626]" /></span>
              {text}
            </li>
          ))}
        </ul>
        <Button
          data-testid="btn-google-login"
          onClick={login}
          className="mt-10 w-full sm:w-auto self-start rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white h-12 px-7 text-sm font-semibold rise"
          style={{ animationDelay: "240ms" }}
        >
          <svg className="h-4 w-4 mr-3" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/>
          </svg>
          Entrar com Google
        </Button>
      </div>
      <div className="hidden lg:block relative">
        <img
          src="https://images.unsplash.com/photo-1753351052363-53ce102830eb?crop=entropy&cs=srgb&fm=jpg&q=85&w=1400"
          alt="Proprietária em seu estabelecimento"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A]/70 via-transparent to-transparent" />
        <div className="absolute bottom-10 left-10 right-10 rounded-2xl bg-white/85 backdrop-blur-xl border border-white p-5 max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A929B]">Sábado · pico</p>
          <p className="font-display text-3xl font-extrabold mt-1">12<span className="text-[#8A929B] text-lg">/12</span> em operação</p>
        </div>
      </div>
    </div>
  );
}

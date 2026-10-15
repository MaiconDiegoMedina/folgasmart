import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { http } from "@/lib/api";

export const AuthCallback = () => {
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const sessionId = new URLSearchParams(window.location.hash.slice(1)).get("session_id");
    http
      .post("/auth/session", { session_id: sessionId })
      .then(({ data }) => navigate("/", { replace: true, state: { user: data } }))
      .catch(() => {
        toast.error("Não foi possível entrar. Tente novamente.");
        navigate("/login", { replace: true });
      });
  }, [navigate]);

  return null;
};

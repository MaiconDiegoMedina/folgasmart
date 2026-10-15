import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { http } from "@/lib/api";

export const ProtectedRoute = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(location.state?.user || null);
  const [auth, setAuth] = useState(location.state?.user ? true : null);

  useEffect(() => {
    if (location.state?.user) return;
    http
      .get("/auth/me")
      .then(({ data }) => { setUser(data); setAuth(true); })
      .catch(() => { setAuth(false); navigate("/login", { replace: true }); });
  }, [location.state, navigate]);

  if (auth !== true) {
    return (
      <div data-testid="auth-loading" className="min-h-screen grid place-items-center bg-[#F9F8F5]">
        <Loader2 className="h-6 w-6 animate-spin text-[#575E65]" />
      </div>
    );
  }
  return children(user);
};

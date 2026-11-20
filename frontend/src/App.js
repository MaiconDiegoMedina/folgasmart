import "@/App.css";
import { Toaster } from "@/components/ui/sonner";
import Dashboard from "@/pages/Dashboard";
import ConvocationAnswer from "@/pages/ConvocationAnswer";
import { LoginGate } from "@/components/LoginGate";

// Link da convocação do intermitente (?convocacao=...): abre a página de resposta, sem login
const convocationToken = new URLSearchParams(window.location.search).get("convocacao");

function App() {
  if (convocationToken) return <ConvocationAnswer token={convocationToken} />;
  return (
    <div className="App">
      <LoginGate><Dashboard /></LoginGate>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

export default App;

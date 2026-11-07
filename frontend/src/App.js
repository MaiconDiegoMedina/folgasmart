import "@/App.css";
import { Toaster } from "@/components/ui/sonner";
import Dashboard from "@/pages/Dashboard";
import { LoginGate } from "@/components/LoginGate";

function App() {
  return (
    <div className="App">
      <LoginGate><Dashboard /></LoginGate>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

export default App;

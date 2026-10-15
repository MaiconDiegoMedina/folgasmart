import "@/App.css";
import { Toaster } from "@/components/ui/sonner";
import Dashboard from "@/pages/Dashboard";

function App() {
  return (
    <div className="App">
      <Dashboard />
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

export default App;

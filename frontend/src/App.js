import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";

// Admin imports
import AdminLayout from "./layouts/AdminLayout";
import AdminLogin from "./pages/admin/Login";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminContents from "./pages/admin/Contents";
import AdminHero from "./pages/admin/Hero";
import AdminSections from "./pages/admin/Sections";
import AdminLogs from "./pages/admin/Logs";
import { Toaster } from "./components/ui/sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Home = () => {
  const helloWorldApi = async () => {
    try {
      const response = await axios.get(`${API}/`);
      console.log(response.data.message);
    } catch (e) {
      console.error(e, `errored out requesting / api`);
    }
  };

  useEffect(() => {
    helloWorldApi();
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-8">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold mb-4" style={{ fontFamily: 'Unbounded, sans-serif' }}>
          <span className="text-[#E50914]">FLIX</span>CLONE
        </h1>
        <p className="text-zinc-400 text-lg mb-8">
          Piattaforma streaming in costruzione
        </p>
        <a
          href="/admin"
          className="inline-flex items-center gap-2 bg-[#E50914] hover:bg-[#B20710] text-white font-semibold px-6 py-3 rounded-lg transition-all shadow-lg shadow-red-900/30"
        >
          Accedi all'Admin Panel
        </a>
      </div>
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          {/* Public route */}
          <Route path="/" element={<Home />} />
          
          {/* Admin Login (separate from layout) */}
          <Route path="/admin/login" element={<AdminLogin />} />
          
          {/* Admin Routes with Layout */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="contents" element={<AdminContents />} />
            <Route path="hero" element={<AdminHero />} />
            <Route path="sections" element={<AdminSections />} />
            <Route path="logs" element={<AdminLogs />} />
          </Route>

          {/* Catch all - redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" theme="dark" />
    </div>
  );
}

export default App;

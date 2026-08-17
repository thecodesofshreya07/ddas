import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Search from "./pages/Search";
import Upload from "./pages/Upload";
import Dashboard from "./pages/Dashboard";
import DatasetDetail from "./pages/DatasetDetail";
import AlertCenter from "./pages/AlertCenter";
import AlertDetail from "./pages/AlertDetail";
import AuditLog from "./pages/AuditLog";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          <Route
            path="/search"
            element={
              <ProtectedRoute breadcrumb={[{ label: "Search Registry" }]}>
                <Search />
              </ProtectedRoute>
            }
          />
          <Route
            path="/upload"
            element={
              <ProtectedRoute breadcrumb={[{ label: "Upload Dataset" }]}>
                <Upload />
              </ProtectedRoute>
            }
          />
          <Route
            path="/datasets/:id"
            element={
              <ProtectedRoute
                breadcrumb={[
                  { label: "Search Registry", to: "/search" },
                  { label: "Dataset detail" },
                ]}
              >
                <DatasetDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/alerts"
            element={
              <ProtectedRoute breadcrumb={[{ label: "Alert Center" }]}>
                <AlertCenter />
              </ProtectedRoute>
            }
          />
          <Route
            path="/alerts/:id"
            element={
              <ProtectedRoute
                breadcrumb={[
                  { label: "Alert Center", to: "/alerts" },
                  { label: "Investigation" },
                ]}
              >
                <AlertDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute breadcrumb={[{ label: "Reports & Impact" }]}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute adminOnly breadcrumb={[{ label: "Audit & Compliance" }]}>
                <AuditLog />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

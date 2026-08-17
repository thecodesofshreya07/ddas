import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Shell from "./Shell";

export default function ProtectedRoute({ children, adminOnly = false, breadcrumb }) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/search" replace />;

  return <Shell breadcrumb={breadcrumb}>{children}</Shell>;
}

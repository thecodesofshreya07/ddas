import { createContext, useContext, useState, useCallback } from "react";
import api from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("ddas_user");
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (identifier, password) => {
    const { data } = await api.post("/auth/login", {
      email: identifier.includes("@") ? identifier : undefined,
      username: !identifier.includes("@") ? identifier : undefined,
      password,
    });
    localStorage.setItem("ddas_token", data.token);
    localStorage.setItem("ddas_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async ({ username, password, department, role }) => {
    const { data } = await api.post("/auth/signup", { username, password, department, role });
    localStorage.setItem("ddas_token", data.token);
    localStorage.setItem("ddas_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("ddas_token");
    localStorage.removeItem("ddas_user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, signup, logout }}>{children}</AuthContext.Provider>
  );

}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

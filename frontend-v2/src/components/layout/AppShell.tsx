import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  FileSearch,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { DEMO_MODE } from "../../hooks/useRecoveryData";
const nav = [
  ["/", "Dashboard", LayoutDashboard],
  ["/audits", "Auditorias", Activity],
  ["/new-audit", "Nova Auditoria", Plus],
  ["/findings", "Findings / Casos", FileSearch],
] as const;
const titles: Record<string, [string, string]> = {
  "/": ["Visão geral", "Dashboard"],
  "/audits": ["Operação", "Auditorias"],
  "/new-audit": ["Operação", "Nova auditoria"],
  "/findings": ["Análise", "Findings / Casos"],
};
export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const title = titles[location.pathname] ?? titles["/"];
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (open ? "open" : "")}>
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <b>Recovery</b>
            <small>Revenue Intelligence</small>
          </div>
          <button
            className="icon mobile-only"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          >
            <X />
          </button>
        </div>
        <nav>
          <p>Workspace</p>
          {nav.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setOpen(false)}
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="secure">
            <ShieldCheck />
            <div>
              <b>Ambiente seguro</b>
              <small>Backend como fonte da verdade</small>
            </div>
          </div>
          <div className="profile">
            <span>IV</span>
            <div>
              <b>Ivo Victorazzo</b>
              <small>Administrador</small>
            </div>
          </div>
        </div>
      </aside>
      <div
        className={"scrim " + (open ? "show" : "")}
        onClick={() => setOpen(false)}
      />
      <main>
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon menu"
              onClick={() => setOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu />
            </button>
            <div>
              <small>{title[0]}</small>
              <h1>{title[1]}</h1>
            </div>
          </div>
          <div className="top-actions">
            {DEMO_MODE && <span className="demo-badge">Demo mode</span>}
            <button className="icon desktop-search" aria-label="Buscar">
              <Search />
            </button>
            <NavLink className="button primary" to="/new-audit">
              <Plus />
              Nova auditoria
            </NavLink>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

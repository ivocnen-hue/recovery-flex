import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Dashboard } from "../pages/Dashboard/Dashboard";
import { Audits } from "../pages/Audits/Audits";
import { NewAudit } from "../pages/NewAudit/NewAudit";
import { Findings } from "../pages/Findings/Findings";
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "audits", element: <Audits /> },
      { path: "new-audit", element: <NewAudit /> },
      { path: "findings", element: <Findings /> },
    ],
  },
]);

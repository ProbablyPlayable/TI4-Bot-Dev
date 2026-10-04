import { createContext, useContext, type ReactNode } from "react";

export const WorkspaceContext = createContext({
  active: true,
  actionable: true,
  draft: false,
  refreshKey: "",
  chrome: null as ReactNode,
});
export const useWorkspace = () => useContext(WorkspaceContext);

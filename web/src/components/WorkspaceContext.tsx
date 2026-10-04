import { createContext, useContext, type ReactNode } from "react";
import type { RecordedDecisionDto } from "../protocol/types.ts";

interface Workspace {
  active: boolean;
  actionable: boolean;
  draft: boolean;
  refreshKey: string;
  chrome: ReactNode;
  movementEdit?: { revision: number; decisions: RecordedDecisionDto[] };
  movementEditRevision?: number;
}
export const WorkspaceContext = createContext<Workspace>({
  active: true,
  actionable: true,
  draft: false,
  refreshKey: "",
  chrome: null as ReactNode,
});
export const useWorkspace = () => useContext(WorkspaceContext);

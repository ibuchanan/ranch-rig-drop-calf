export type RepositoryOptions = {
  operation: "init" | "update";
  branch: string;
  authorName: string;
  authorEmail: string;
  remoteUrl?: string;
  provenance?: string;
};

export type RepositoryResult = {
  status: "initialized" | "updated" | "unchanged" | "failed";
  targetBranch: string;
  base: string;
  head: string;
  updateBranch?: string;
  updateCommit?: string;
  error?: string;
  published?: boolean;
};

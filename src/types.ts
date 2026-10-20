export interface Identity {
  name: string;
  email: string;
}

export interface ScheduleConfig {
  start: number; // minutes from midnight
  end: number;
  timezone: string;
  allowedDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  anchor: { type: "start" | "end"; date: Date };
}

export interface HerodotusConfig {
  identities: Identity[];
  schedule: ScheduleConfig;
  inPlace: boolean;
  dryRun: boolean;
  branch: string;
  repoPath: string;
  seed: number;
}

export interface CommitInfo {
  index: number;
  originalAuthor: Identity;
  authorDate: string; // raw fast-export format: "timestamp tz"
  message: string;
  newAuthor: Identity;
  newAuthorDate: string;
}

export interface Identity {
  name: string;
  email: string;
}

export interface ScheduleConfig {
  start: number; // minutes from midnight
  end: number;
  timezone: string;
  allowedDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  futureDates: boolean;
}

export interface HerodotusConfig {
  identities: Identity[];
  schedule: ScheduleConfig;
  inPlace: boolean;
  dryRun: boolean;
  branch: string;
  repoPath: string;
  backup: string | false;
  seed: number;
}

export interface CommitInfo {
  index: number;
  originalAuthor: Identity;
  originalCommitter: Identity;
  authorDate: string; // raw fast-export format: "timestamp tz"
  commitDate: string;
  message: string;
  newAuthor?: Identity;
  newCommitter?: Identity;
  newAuthorDate?: string;
  newCommitDate?: string;
}

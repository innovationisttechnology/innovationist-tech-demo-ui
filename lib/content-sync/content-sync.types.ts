// camelCase domain model the UI works with (mapped from `SyncFlagSchema`).
export type SyncFlag = {
  sessionId: string;
  key: string;
  value: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateFlagInput = {
  key: string;
  value: string;
  enabled?: boolean;
};

export type UpdateFlagInput = {
  value?: string;
  enabled?: boolean;
};

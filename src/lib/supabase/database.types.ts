import type { SourceType } from "@/lib/sources";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type IngestionStatus = "success" | "failure" | "partial";
export type ArtifactType = "try" | "patch";
export type CardAction = "ignore" | "try" | "patch";

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      sources: Table<
        {
          id: string;
          name: string;
          type: SourceType;
          url: string | null;
          last_run_at: string | null;
          last_status: IngestionStatus | null;
        },
        {
          id?: string;
          name: string;
          type: SourceType;
          url?: string | null;
          last_run_at?: string | null;
          last_status?: IngestionStatus | null;
        },
        {
          id?: string;
          name?: string;
          type?: SourceType;
          url?: string | null;
          last_run_at?: string | null;
          last_status?: IngestionStatus | null;
        }
      >;
      stories: Table<
        {
          id: string;
          source_id: string;
          title: string;
          url: string;
          body: string | null;
          fetched_at: string;
        },
        {
          id?: string;
          source_id: string;
          title: string;
          url: string;
          body?: string | null;
          fetched_at?: string;
        },
        {
          id?: string;
          source_id?: string;
          title?: string;
          url?: string;
          body?: string | null;
          fetched_at?: string;
        }
      >;
      users: Table<
        {
          id: string;
          email: string;
          profile_md: string | null;
          github_pat_encrypted: string | null;
          created_at: string;
        },
        {
          id: string;
          email: string;
          profile_md?: string | null;
          github_pat_encrypted?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          email?: string;
          profile_md?: string | null;
          github_pat_encrypted?: string | null;
          created_at?: string;
        }
      >;
      user_repos: Table<
        {
          id: string;
          user_id: string;
          repo_url: string;
          readme: string | null;
          manifest_json: Json | null;
          fetched_at: string;
        },
        {
          id?: string;
          user_id: string;
          repo_url: string;
          readme?: string | null;
          manifest_json?: Json | null;
          fetched_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          repo_url?: string;
          readme?: string | null;
          manifest_json?: Json | null;
          fetched_at?: string;
        }
      >;
      story_scores: Table<
        {
          story_id: string;
          user_id: string;
          score: number;
          why_i_care: string;
          tags: string[];
          scored_at: string;
        },
        {
          story_id: string;
          user_id: string;
          score: number;
          why_i_care: string;
          tags: string[];
          scored_at?: string;
        },
        {
          story_id?: string;
          user_id?: string;
          score?: number;
          why_i_care?: string;
          tags?: string[];
          scored_at?: string;
        }
      >;
      scoring_retry_queue: Table<
        {
          story_id: string;
          user_id: string;
          failure_reason: string | null;
          enqueued_at: string;
        },
        {
          story_id: string;
          user_id: string;
          failure_reason?: string | null;
          enqueued_at?: string;
        },
        {
          story_id?: string;
          user_id?: string;
          failure_reason?: string | null;
          enqueued_at?: string;
        }
      >;
      card_actions: Table<
        {
          id: string;
          user_id: string;
          story_id: string;
          action: CardAction;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          story_id: string;
          action: CardAction;
          created_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          story_id?: string;
          action?: CardAction;
          created_at?: string;
        }
      >;
      artifacts: Table<
        {
          id: string;
          user_id: string;
          story_id: string;
          type: ArtifactType;
          content: string;
          run_command: string | null;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          story_id: string;
          type: ArtifactType;
          content: string;
          run_command?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          story_id?: string;
          type?: ArtifactType;
          content?: string;
          run_command?: string | null;
          created_at?: string;
        }
      >;
      ingestion_log: Table<
        {
          id: string;
          source_id: string | null;
          run_at: string;
          status: IngestionStatus;
          error_text: string | null;
        },
        {
          id?: string;
          source_id?: string | null;
          run_at?: string;
          status: IngestionStatus;
          error_text?: string | null;
        },
        {
          id?: string;
          source_id?: string | null;
          run_at?: string;
          status?: IngestionStatus;
          error_text?: string | null;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      try_charge_budget: {
        Args: { p_amount: number };
        Returns: boolean;
      };
    };
    Enums: {
      source_type: SourceType;
      ingestion_status: IngestionStatus;
      artifact_type: ArtifactType;
      card_action: CardAction;
    };
    CompositeTypes: Record<string, never>;
  };
};

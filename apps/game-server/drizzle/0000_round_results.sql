CREATE TABLE "round_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_session_id" text NOT NULL,
	"match_id" text NOT NULL,
	"round_id" integer NOT NULL,
	"map_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"winner" text NOT NULL,
	"team_units" jsonb NOT NULL,
	"total_units" integer NOT NULL,
	"percent" jsonb NOT NULL,
	"deliveries" jsonb NOT NULL,
	"players" jsonb NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "round_results_match_round_uq" ON "round_results" USING btree ("match_id","round_id");
ALTER TYPE "public"."type" ADD VALUE 'CODE_READ';--> statement-breakpoint
ALTER TYPE "public"."type" ADD VALUE 'CODE_OUTPUT';--> statement-breakpoint
ALTER TYPE "public"."type" ADD VALUE 'CODE_FILL';--> statement-breakpoint
ALTER TYPE "public"."type" ADD VALUE 'CODE_ORDER';--> statement-breakpoint
ALTER TYPE "public"."type" ADD VALUE 'CODE_WRITE';--> statement-breakpoint
ALTER TYPE "public"."type" ADD VALUE 'CODE_FIX';--> statement-breakpoint
ALTER TYPE "public"."type" ADD VALUE 'WEB_LIVE';--> statement-breakpoint
ALTER TYPE "public"."type" ADD VALUE 'MATH';--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"challenge_id" integer NOT NULL,
	"draft" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_drafts_user_id_challenge_id_unique" UNIQUE("user_id","challenge_id")
);
--> statement-breakpoint
CREATE TABLE "code_snippets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"files" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "math_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"challenge_id" integer NOT NULL,
	"solution_version" integer,
	"analysis" jsonb NOT NULL,
	"common_mistake" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "math_analyses_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "math_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"challenge_id" integer NOT NULL,
	"strokes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_path" text,
	"recognized_latex" jsonb,
	"corrected_latex" jsonb,
	"answer" text,
	"grading" jsonb,
	"analysis_id" integer,
	"provider" text,
	"model" text,
	"conversation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "math_solutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"challenge_id" integer NOT NULL,
	"version" integer NOT NULL,
	"script" jsonb NOT NULL,
	"author_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "math_solutions_challenge_id_version_unique" UNIQUE("challenge_id","version")
);
--> statement-breakpoint
CREATE TABLE "user_ai_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text,
	"key_last_four" text,
	"models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tasks" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_ai_settings_user_id_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "user_voice_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"voice" text,
	"speed" real DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_drafts" ADD CONSTRAINT "challenge_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_drafts" ADD CONSTRAINT "challenge_drafts_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_snippets" ADD CONSTRAINT "code_snippets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "math_analyses" ADD CONSTRAINT "math_analyses_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "math_attempts" ADD CONSTRAINT "math_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "math_attempts" ADD CONSTRAINT "math_attempts_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "math_attempts" ADD CONSTRAINT "math_attempts_analysis_id_math_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."math_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "math_solutions" ADD CONSTRAINT "math_solutions_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "math_solutions" ADD CONSTRAINT "math_solutions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_voice_settings" ADD CONSTRAINT "user_voice_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_idx" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "code_snippets_user_idx" ON "code_snippets" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "math_analyses_challenge_idx" ON "math_analyses" USING btree ("challenge_id","common_mistake");--> statement-breakpoint
CREATE INDEX "math_attempts_user_idx" ON "math_attempts" USING btree ("user_id","challenge_id","created_at");--> statement-breakpoint
CREATE INDEX "math_attempts_challenge_idx" ON "math_attempts" USING btree ("challenge_id");
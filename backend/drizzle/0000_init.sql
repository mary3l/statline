CREATE TYPE "public"."availability_kind" AS ENUM('injury', 'suspension');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('scheduled', 'live', 'final', 'forfeit');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('F', 'M');--> statement-breakpoint
CREATE TYPE "public"."player_status" AS ENUM('available', 'injured', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."position" AS ENUM('PG', 'SG', 'SF', 'PF', 'C');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'organizer', 'scorer');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('home', 'away');--> statement-breakpoint
CREATE TABLE "availability_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "availability_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"kind" "availability_kind" NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"started_on" date NOT NULL,
	"ended_on" date
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "awards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"year" integer NOT NULL,
	"title" text NOT NULL,
	"league_id" integer
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"period" integer NOT NULL,
	"clock" integer NOT NULL,
	"type" text NOT NULL,
	"side" "side",
	"player_id" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "game_participants" (
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"side" "side" NOT NULL,
	"jersey" text NOT NULL,
	"starter" boolean DEFAULT false NOT NULL,
	CONSTRAINT "game_participants_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"league_id" integer NOT NULL,
	"game_number" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"venue" text,
	"home_team_id" integer NOT NULL,
	"away_team_id" integer NOT NULL,
	"status" "game_status" DEFAULT 'scheduled' NOT NULL,
	"forfeited_by" "side",
	"home_score" integer,
	"away_score" integer,
	"periods" integer
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leagues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"gender" "gender",
	"min_age" integer,
	"max_age" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "leagues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "player_game_lines" (
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"league_id" integer NOT NULL,
	"starter" boolean NOT NULL,
	"seconds" integer NOT NULL,
	"pts" integer NOT NULL,
	"fg2m" integer NOT NULL,
	"fg2a" integer NOT NULL,
	"fg3m" integer NOT NULL,
	"fg3a" integer NOT NULL,
	"ftm" integer NOT NULL,
	"fta" integer NOT NULL,
	"oreb" integer NOT NULL,
	"dreb" integer NOT NULL,
	"ast" integer NOT NULL,
	"stl" integer NOT NULL,
	"blk" integer NOT NULL,
	"tov" integer NOT NULL,
	"pf" integer NOT NULL,
	"fd" integer NOT NULL,
	"pir" integer NOT NULL,
	"plus_minus" integer NOT NULL,
	CONSTRAINT "player_game_lines_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "player_leagues" (
	"player_id" integer NOT NULL,
	"league_id" integer NOT NULL,
	CONSTRAINT "player_leagues_player_id_league_id_pk" PRIMARY KEY("player_id","league_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "players_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birthdate" date NOT NULL,
	"gender" "gender" NOT NULL,
	"position" "position" NOT NULL,
	"secondary_position" "position",
	"height_cm" integer,
	"weight_kg" integer,
	"dominant_hand" text,
	"status" "player_status" DEFAULT 'available' NOT NULL,
	"birth_cert_verified_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roster_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"jersey" text NOT NULL,
	"joined_on" date,
	"left_on" date
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seasons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "seasons_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "availability_events" ADD CONSTRAINT "availability_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_lines" ADD CONSTRAINT "player_game_lines_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_lines" ADD CONSTRAINT "player_game_lines_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_lines" ADD CONSTRAINT "player_game_lines_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_lines" ADD CONSTRAINT "player_game_lines_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_lines" ADD CONSTRAINT "player_game_lines_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_leagues" ADD CONSTRAINT "player_leagues_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_leagues" ADD CONSTRAINT "player_leagues_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_player_idx" ON "availability_events" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "awards_player_idx" ON "awards" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_game_seq_uq" ON "events" USING btree ("game_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "games_number_uq" ON "games" USING btree ("league_id","season_id","game_number");--> statement-breakpoint
CREATE INDEX "games_season_league_idx" ON "games" USING btree ("season_id","league_id");--> statement-breakpoint
CREATE INDEX "pgl_season_league_idx" ON "player_game_lines" USING btree ("season_id","league_id");--> statement-breakpoint
CREATE INDEX "pgl_player_idx" ON "player_game_lines" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "players_name_idx" ON "players" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_active_jersey_uq" ON "roster_entries" USING btree ("team_id","season_id","jersey") WHERE "roster_entries"."left_on" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_active_player_uq" ON "roster_entries" USING btree ("player_id","season_id") WHERE "roster_entries"."left_on" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_league_name_uq" ON "teams" USING btree ("league_id","name");
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { MAX_HEARTS } from "@/constants";
import { CHALLENGE_TYPES } from "@/lib/exercises/types";

export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  imageSrc: text("image_src").notNull(),
});

export const coursesRelations = relations(courses, ({ many }) => ({
  userProgress: many(userProgress),
  units: many(units),
}));

export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(), // Unit 1
  description: text("description").notNull(), // Learn the basics of spanish
  courseId: integer("course_id")
    .references(() => courses.id, {
      onDelete: "cascade",
    })
    .notNull(),
  order: integer("order").notNull(),
});

export const unitsRelations = relations(units, ({ many, one }) => ({
  course: one(courses, {
    fields: [units.courseId],
    references: [courses.id],
  }),
  lessons: many(lessons),
}));

export const lessons = pgTable("lessons", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  unitId: integer("unit_id")
    .references(() => units.id, {
      onDelete: "cascade",
    })
    .notNull(),
  order: integer("order").notNull(),
});

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  unit: one(units, {
    fields: [lessons.unitId],
    references: [units.id],
  }),
  challenges: many(challenges),
}));

// SELECT and ASSIST are upstream's; the coding and math types are listed in lib/exercises/types.ts.
export const challengesEnum = pgEnum("type", CHALLENGE_TYPES);

export const challenges = pgTable("challenges", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id")
    .references(() => lessons.id, {
      onDelete: "cascade",
    })
    .notNull(),
  type: challengesEnum("type").notNull(),
  question: text("question").notNull(),
  // Optional, from course files or the admin screens: a hint the learner can open before
  // answering and an explanation shown once the answer is checked.
  hint: text("hint"),
  explanation: text("explanation"),
  order: integer("order").notNull(),
  // Everything a coding or math exercise needs (language, starter code, tests, answer spec...).
  // Null for SELECT and ASSIST. Checked per type by lib/exercises/payload.ts.
  payload: jsonb("payload"),
});

export const challengesRelations = relations(challenges, ({ one, many }) => ({
  lesson: one(lessons, {
    fields: [challenges.lessonId],
    references: [lessons.id],
  }),
  challengeOptions: many(challengeOptions),
  challengeProgress: many(challengeProgress),
}));

export const challengeOptions = pgTable("challenge_options", {
  id: serial("id").primaryKey(),
  challengeId: integer("challenge_id")
    .references(() => challenges.id, {
      onDelete: "cascade",
    })
    .notNull(),
  text: text("text").notNull(),
  correct: boolean("correct").notNull(),
  imageSrc: text("image_src"),
  audioSrc: text("audio_src"),
});

export const challengeOptionsRelations = relations(
  challengeOptions,
  ({ one }) => ({
    challenge: one(challenges, {
      fields: [challengeOptions.challengeId],
      references: [challenges.id],
    }),
  })
);

export const challengeProgress = pgTable(
  "challenge_progress",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    challengeId: integer("challenge_id")
      .references(() => challenges.id, {
        onDelete: "cascade",
      })
      .notNull(),
    completed: boolean("completed").notNull().default(false),
  },
  (t) => [unique().on(t.userId, t.challengeId)]
);

export const challengeProgressRelations = relations(
  challengeProgress,
  ({ one }) => ({
    challenge: one(challenges, {
      fields: [challengeProgress.challengeId],
      references: [challenges.id],
    }),
  })
);

export const userProgress = pgTable("user_progress", {
  userId: text("user_id").primaryKey(),
  userName: text("user_name").notNull().default("User"),
  userImageSrc: text("user_image_src").notNull().default("/mascot.svg"),
  activeCourseId: integer("active_course_id").references(() => courses.id, {
    onDelete: "cascade",
  }),
  hearts: integer("hearts").notNull().default(MAX_HEARTS),
  points: integer("points").notNull().default(0),
});

export const userProgressRelations = relations(userProgress, ({ one }) => ({
  activeCourse: one(courses, {
    fields: [userProgress.activeCourseId],
    references: [courses.id],
  }),
}));

// Accounts live in this database (no outside sign-in service). People join only with a
// single-use invite code made on the server with scripts/lingo.mjs.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  imageSrc: text("image_src").notNull().default("/mascot.svg"),
  isAdmin: boolean("is_admin").notNull().default(false),
  disabled: boolean("disabled").notNull().default(false),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

// One row per signed-in browser. The id is the SHA-256 of the cookie value, so a copy of the
// database alone cannot be used to sign in.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// Single-use codes. A code with resetUserId set lets that existing account choose a new
// password instead of creating a new account.
export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  note: text("note").notNull().default(""),
  isAdmin: boolean("is_admin").notNull().default(false),
  resetUserId: text("reset_user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  usedBy: text("used_by"),
});

// ---- Coding lessons and math practice (docs/DESIGN-coding-and-math.md) ----
// New tables only, so upstream's tables keep their shape. Times are UTC like the rest.

const createdAt = () => timestamp("created_at").notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const userRef = () =>
  text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull();
const challengeRef = () =>
  integer("challenge_id")
    .references(() => challenges.id, { onDelete: "cascade" })
    .notNull();

// The learner's unfinished work per challenge (code, ink strokes), restored on return.
export const challengeDrafts = pgTable(
  "challenge_drafts",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    challengeId: challengeRef(),
    draft: jsonb("draft").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.userId, t.challengeId)]
);

// Playground programs saved under a name. files: [{ name, content }].
export const codeSnippets = pgTable(
  "code_snippets",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    language: text("language").notNull(),
    files: jsonb("files").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("code_snippets_user_idx").on(t.userId, t.updatedAt)]
);

// Animated solution scripts. Every save is a new version; old versions stay.
export const mathSolutions = pgTable(
  "math_solutions",
  {
    id: serial("id").primaryKey(),
    challengeId: challengeRef(),
    version: integer("version").notNull(),
    script: jsonb("script").notNull(),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.challengeId, t.version)]
);

// Stored step analyses, found again by a fingerprint of the problem, the solution version and
// the learner's normalised lines, so the same work is answered without a new AI call.
export const mathAnalyses = pgTable(
  "math_analyses",
  {
    id: serial("id").primaryKey(),
    fingerprint: text("fingerprint").notNull().unique(),
    challengeId: challengeRef(),
    solutionVersion: integer("solution_version"),
    analysis: jsonb("analysis").notNull(),
    commonMistake: boolean("common_mistake").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("math_analyses_challenge_idx").on(t.challengeId, t.commonMistake)]
);

// One handwritten attempt: strokes, the rendered image, recognised lines, the learner's
// corrections, the final answer, the grading and any follow-up conversation.
export const mathAttempts = pgTable(
  "math_attempts",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    challengeId: challengeRef(),
    strokes: jsonb("strokes").notNull().default([]),
    imagePath: text("image_path"),
    recognizedLatex: jsonb("recognized_latex"),
    correctedLatex: jsonb("corrected_latex"),
    answer: text("answer"),
    grading: jsonb("grading"),
    analysisId: integer("analysis_id").references(() => mathAnalyses.id, {
      onDelete: "set null",
    }),
    provider: text("provider"),
    model: text("model"),
    conversation: jsonb("conversation").notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("math_attempts_user_idx").on(t.userId, t.challengeId, t.createdAt),
    index("math_attempts_challenge_idx").on(t.challengeId),
  ]
);

// Per account and AI provider: the encrypted key (AES-256-GCM, lib/ai/crypto.ts), its last
// four characters for display, the model chosen per task, and the tasks sent to this provider.
export const userAiSettings = pgTable(
  "user_ai_settings",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key"),
    keyLastFour: text("key_last_four"),
    models: jsonb("models").notNull().default({}),
    tasks: text("tasks").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.userId, t.provider)]
);

export const userVoiceSettings = pgTable("user_voice_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  voice: text("voice"),
  speed: real("speed").notNull().default(1),
  updatedAt: updatedAt(),
});

// Tokens used per request, so every account can see its own usage.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    task: text("task").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt)]
);

export const challengeDraftsRelations = relations(challengeDrafts, ({ one }) => ({
  challenge: one(challenges, {
    fields: [challengeDrafts.challengeId],
    references: [challenges.id],
  }),
}));

export const mathSolutionsRelations = relations(mathSolutions, ({ one }) => ({
  challenge: one(challenges, {
    fields: [mathSolutions.challengeId],
    references: [challenges.id],
  }),
}));

export const mathAttemptsRelations = relations(mathAttempts, ({ one }) => ({
  challenge: one(challenges, {
    fields: [mathAttempts.challengeId],
    references: [challenges.id],
  }),
  analysis: one(mathAnalyses, {
    fields: [mathAttempts.analysisId],
    references: [mathAnalyses.id],
  }),
}));

export const mathAnalysesRelations = relations(mathAnalyses, ({ one }) => ({
  challenge: one(challenges, {
    fields: [mathAnalyses.challengeId],
    references: [challenges.id],
  }),
}));

// Course files (JSON) to database rows. Shared by scripts/start.mjs (demo course on a new
// database) and scripts/lingo.mjs (import and update commands). The format is described in
// SELF-HOSTED.md.
//
// The coding and math types carry a payload, checked by lib/exercises/payload.ts and the rules of
// each track. Those are TypeScript files: the Docker build bundles this script with esbuild, and
// outside Docker it runs with tsx (pnpm exec tsx scripts/lingo.mjs ...).
import { checkChallengePayload } from "../lib/exercises/payload.ts";
import { CHALLENGE_TYPES, isExerciseType } from "../lib/exercises/types.ts";
import { splitSolutionScript, storeCourseSolution } from "../lib/math/solution/course.ts";

const TYPES = new Set(CHALLENGE_TYPES);
const isPath = (v) => typeof v === "string" && v.startsWith("/");

export const checkCourse = (course) => {
  const errors = [];
  const where = (...parts) => parts.join(" > ");

  if (!course || typeof course !== "object") return ["The file is not a course object."];
  if (typeof course.title !== "string" || !course.title.trim()) errors.push("Course: title missing.");
  if (!isPath(course.imageSrc)) errors.push('Course: imageSrc must be a path such as "/es.svg" or "/media/cover.png".');
  if (!Array.isArray(course.units) || !course.units.length) errors.push("Course: needs at least one unit.");

  (course.units ?? []).forEach((unit, u) => {
    const U = `Unit ${u + 1}`;
    if (typeof unit.title !== "string" || !unit.title.trim()) errors.push(where(U, "title missing."));
    if (typeof unit.description !== "string") errors.push(where(U, "description missing."));
    if (!Array.isArray(unit.lessons) || !unit.lessons.length) errors.push(where(U, "needs at least one lesson."));

    (unit.lessons ?? []).forEach((lesson, l) => {
      const L = `lesson ${l + 1}`;
      if (typeof lesson.title !== "string" || !lesson.title.trim()) errors.push(where(U, L, "title missing."));
      if (!Array.isArray(lesson.challenges) || !lesson.challenges.length)
        errors.push(where(U, L, "needs at least one challenge."));

      (lesson.challenges ?? []).forEach((ch, c) => {
        const C = `challenge ${c + 1}`;
        if (!TYPES.has(ch.type)) errors.push(where(U, L, C, `type must be one of ${[...TYPES].join(", ")}.`));
        if (typeof ch.question !== "string" || !ch.question.trim()) errors.push(where(U, L, C, "question missing."));
        for (const key of ["hint", "explanation"])
          if (ch[key] != null && typeof ch[key] !== "string") errors.push(where(U, L, C, `${key} must be text.`));
        if (ch.options != null && !Array.isArray(ch.options)) errors.push(where(U, L, C, "options must be a list."));
        const options = Array.isArray(ch.options) ? ch.options : [];
        // Multiple choice needs its options; coding and math exercises may use them or not.
        if (!isExerciseType(ch.type)) {
          if (options.length < 2) errors.push(where(U, L, C, "needs at least two options."));
          if (options.filter((o) => o.correct === true).length !== 1)
            errors.push(where(U, L, C, "needs exactly one option with correct: true."));
        }
        if (TYPES.has(ch.type))
          for (const problem of checkChallengePayload(ch.type, ch.payload, { question: ch.question ?? "", options }))
            errors.push(where(U, L, C, problem));
        options.forEach((o, i) => {
          const O = `option ${i + 1}`;
          if (typeof o.text !== "string" || !o.text.trim()) errors.push(where(U, L, C, O, "text missing."));
          if (o.imageSrc != null && !isPath(o.imageSrc)) errors.push(where(U, L, C, O, 'imageSrc must start with "/".'));
          if (o.audioSrc != null && !isPath(o.audioSrc)) errors.push(where(U, L, C, O, 'audioSrc must start with "/".'));
        });
      });
    });
  });

  return errors;
};

const one = async (client, text, values) => (await client.query(text, values)).rows[0];
const note = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
// A MATH solution script goes to math_solutions, not into the payload (lib/math/solution/course.ts).
const payloadOf = (ch) => {
  const { payload } = splitSolutionScript(ch.type, ch.payload);
  return payload == null ? null : JSON.stringify(payload);
};
const storeScript = async (client, challengeId, ch, counts) => {
  const { script } = splitSolutionScript(ch.type, ch.payload);
  if (script && (await storeCourseSolution(client, challengeId, script))) counts.solutions++;
};
const optionsOf = (ch) => (Array.isArray(ch.options) ? ch.options : []);

// Adds the whole course in one transaction: either all of it lands or none of it does.
export const importCourse = async (pool, course) => {
  const errors = checkCourse(course);
  if (errors.length) throw new Error(`The course file has problems:\n  ${errors.join("\n  ")}`);

  const client = await pool.connect();
  const counts = { units: 0, lessons: 0, challenges: 0, solutions: 0 };
  try {
    await client.query("begin");
    const existing = await client.query("select id from courses where lower(title) = lower($1)", [course.title.trim()]);
    if (existing.rowCount)
      throw new Error(
        `A course named "${course.title}" already exists. Change the title in the file, or delete that course in the admin screens first.`
      );

    const { id: courseId } = await one(client, "insert into courses (title, image_src) values ($1, $2) returning id", [
      course.title.trim(),
      course.imageSrc,
    ]);
    for (const [u, unit] of course.units.entries()) {
      const { id: unitId } = await one(
        client,
        'insert into units (title, description, course_id, "order") values ($1, $2, $3, $4) returning id',
        [unit.title, unit.description, courseId, u + 1]
      );
      counts.units++;
      for (const [l, lesson] of unit.lessons.entries()) {
        const { id: lessonId } = await one(
          client,
          'insert into lessons (title, unit_id, "order") values ($1, $2, $3) returning id',
          [lesson.title, unitId, l + 1]
        );
        counts.lessons++;
        for (const [c, ch] of lesson.challenges.entries()) {
          const { id: challengeId } = await one(
            client,
            'insert into challenges (lesson_id, type, question, hint, explanation, "order", payload) values ($1, $2, $3, $4, $5, $6, $7) returning id',
            [lessonId, ch.type, ch.question, note(ch.hint), note(ch.explanation), c + 1, payloadOf(ch)]
          );
          counts.challenges++;
          await storeScript(client, challengeId, ch, counts);
          for (const o of optionsOf(ch)) {
            await client.query(
              "insert into challenge_options (challenge_id, text, correct, image_src, audio_src) values ($1, $2, $3, $4, $5)",
              [challengeId, o.text, o.correct === true, o.imageSrc ?? null, o.audioSrc ?? null]
            );
          }
        }
      }
    }
    await client.query("commit");
    return { courseId, ...counts };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

// Applies a changed file to the course with the same title, in place, so everyone's progress
// stays: titles, descriptions, types, questions, answers, pictures, sounds, hints, explanations
// and payloads are replaced, and a changed solution script becomes a new version. Units, lessons, challenges and
// options must match the database in number and order;
// otherwise nothing changes.
export const updateCourse = async (pool, course) => {
  const errors = checkCourse(course);
  if (errors.length) throw new Error(`The course file has problems:\n  ${errors.join("\n  ")}`);

  const client = await pool.connect();
  const counts = { units: 0, lessons: 0, challenges: 0, solutions: 0 };
  const ids = async (text, id) => (await client.query(text, [id])).rows.map((r) => r.id);
  const sameCount = (what, inDb, inFile) => {
    if (inDb.length !== inFile.length)
      throw new Error(`${what}: ${inDb.length} in the app, ${inFile.length} in the file. Only texts can be updated.`);
  };
  try {
    await client.query("begin");
    const found = await client.query("select id from courses where lower(title) = lower($1)", [course.title.trim()]);
    if (!found.rowCount) throw new Error(`There is no course named "${course.title}" yet. Add it with import.`);
    const courseId = found.rows[0].id;
    await client.query("update courses set image_src = $2 where id = $1", [courseId, course.imageSrc]);

    const unitIds = await ids('select id from units where course_id = $1 order by "order", id', courseId);
    sameCount("Units", unitIds, course.units);
    for (const [u, unit] of course.units.entries()) {
      const U = `Unit ${u + 1}`;
      await client.query("update units set title = $2, description = $3 where id = $1", [unitIds[u], unit.title, unit.description]);
      counts.units++;

      const lessonIds = await ids('select id from lessons where unit_id = $1 order by "order", id', unitIds[u]);
      sameCount(`${U} lessons`, lessonIds, unit.lessons);
      for (const [l, lesson] of unit.lessons.entries()) {
        const L = `${U} > lesson ${l + 1}`;
        await client.query("update lessons set title = $2 where id = $1", [lessonIds[l], lesson.title]);
        counts.lessons++;

        const challengeIds = await ids('select id from challenges where lesson_id = $1 order by "order", id', lessonIds[l]);
        sameCount(`${L} challenges`, challengeIds, lesson.challenges);
        for (const [c, ch] of lesson.challenges.entries()) {
          await client.query(
            "update challenges set type = $2, question = $3, hint = $4, explanation = $5, payload = $6 where id = $1",
            [challengeIds[c], ch.type, ch.question, note(ch.hint), note(ch.explanation), payloadOf(ch)]
          );
          counts.challenges++;
          await storeScript(client, challengeIds[c], ch, counts);

          const optionIds = await ids("select id from challenge_options where challenge_id = $1 order by id", challengeIds[c]);
          sameCount(`${L} > challenge ${c + 1} options`, optionIds, optionsOf(ch));
          for (const [o, option] of optionsOf(ch).entries()) {
            await client.query(
              "update challenge_options set text = $2, correct = $3, image_src = $4, audio_src = $5 where id = $1",
              [optionIds[o], option.text, option.correct === true, option.imageSrc ?? null, option.audioSrc ?? null]
            );
          }
        }
      }
    }
    await client.query("commit");
    return { courseId, ...counts };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

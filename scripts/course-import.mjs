// Course files (JSON) to database rows. Shared by scripts/start.mjs (demo course on a new
// database) and scripts/lingo.mjs (import and update commands). The format is described in
// SELF-HOSTED.md.

const TYPES = new Set(["SELECT", "ASSIST"]);
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
        if (!TYPES.has(ch.type)) errors.push(where(U, L, C, 'type must be "SELECT" or "ASSIST".'));
        if (typeof ch.question !== "string" || !ch.question.trim()) errors.push(where(U, L, C, "question missing."));
        const options = Array.isArray(ch.options) ? ch.options : [];
        if (options.length < 2) errors.push(where(U, L, C, "needs at least two options."));
        if (options.filter((o) => o.correct === true).length !== 1)
          errors.push(where(U, L, C, "needs exactly one option with correct: true."));
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

// Adds the whole course in one transaction: either all of it lands or none of it does.
export const importCourse = async (pool, course) => {
  const errors = checkCourse(course);
  if (errors.length) throw new Error(`The course file has problems:\n  ${errors.join("\n  ")}`);

  const client = await pool.connect();
  const counts = { units: 0, lessons: 0, challenges: 0 };
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
            'insert into challenges (lesson_id, type, question, "order") values ($1, $2, $3, $4) returning id',
            [lessonId, ch.type, ch.question, c + 1]
          );
          counts.challenges++;
          for (const o of ch.options) {
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

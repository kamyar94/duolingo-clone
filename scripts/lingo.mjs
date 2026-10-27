// Server-side account and course tool. Runs inside the app container:
//
//   docker exec lingo-app node scripts/lingo.mjs <command> ...
//
// Bundled with esbuild into the image as /app/scripts/lingo.mjs (see Dockerfile).
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

import pg from "pg";

import { checkCourse, importCourse, updateCourse } from "./course-import.mjs";

const HELP = `Lingo server tool

  invite [--note NAME] [--admin] [--days N]   single-use sign-up code (default: valid 7 days)
  reset USERNAME [--days N]                   single-use code to choose a new password
  users                                       list accounts
  unlock USERNAME                             clear a lock after too many wrong passwords
  admin USERNAME on|off                       give or take the admin screens
  disable USERNAME | enable USERNAME          block or allow an account (ends its sign-ins)
  invites                                     list codes that are still unused
  check FILE.json                             check a course file without importing it
  import FILE.json [FILE.json ...]            add courses from files (format: courses\README.md)
  update FILE.json [FILE.json ...]            apply changed texts to the course with the same title
                                              (same units, lessons and questions; progress stays)`;

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 && args[i + 1] ? args[i + 1] : fallback;
};
const positional = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] ?? "").match(/^--(note|days)$/));

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

// 16 characters from an alphabet without look-alikes (no 0/O, 1/I/L), shown in groups of four.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => {
  const chars = Array.from({ length: 16 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
  return { plain: chars.match(/.{4}/g).join("-"), hash: crypto.createHash("sha256").update(chars).digest("hex") };
};
const link = (code) => `${(process.env.BASE_URL ?? "").replace(/\/$/, "")}/sign-up?code=${code}`;

const pool = new pg.Pool({ max: 1 });
const q = (text, values) => pool.query(text, values);

const findUser = async (username) => {
  if (!username) fail("Give the username.");
  const { rows } = await q("select * from users where username = lower($1)", [username]);
  if (!rows.length) fail(`No account with username "${username}". See: node scripts/lingo.mjs users`);
  return rows[0];
};

const days = () => {
  const n = Number(option("days", "7"));
  if (!Number.isFinite(n) || n <= 0 || n > 90) fail("--days must be between 1 and 90.");
  return n;
};

try {
  switch (command) {
    case "invite": {
      const code = newCode();
      const note = option("note", "");
      await q(
        "insert into invites (code_hash, note, is_admin, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))",
        [code.hash, note, flag("admin"), days()]
      );
      console.log(`Invite code${note ? ` for ${note}` : ""}${flag("admin") ? " (ADMIN)" : ""}: ${code.plain}`);
      console.log(`Link: ${link(code.plain)}`);
      console.log(`Works once, for ${days()} days. Only its fingerprint is stored, so copy it now.`);
      break;
    }
    case "reset": {
      const user = await findUser(positional[0]);
      const code = newCode();
      await q(
        "insert into invites (code_hash, note, reset_user_id, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))",
        [code.hash, `password reset for ${user.username}`, user.id, days()]
      );
      console.log(`Reset code for ${user.username}: ${code.plain}`);
      console.log(`Link: ${link(code.plain)}`);
      console.log("The old password keeps working until the code is used.");
      break;
    }
    case "users": {
      const { rows } = await q(
        `select u.username, u.display_name, u.is_admin, u.disabled, u.locked_until, u.created_at,
                (select count(*) from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions,
                coalesce(p.points, 0) as points
           from users u left join user_progress p on p.user_id = u.id order by u.created_at`
      );
      if (!rows.length) console.log("No accounts yet. Make the first one with: node scripts/lingo.mjs invite --note NAME --admin");
      for (const r of rows) {
        const marks = [r.is_admin && "admin", r.disabled && "DISABLED", r.locked_until > new Date() && "LOCKED"].filter(Boolean);
        console.log(
          `${r.username.padEnd(20)} ${r.display_name.padEnd(20)} ${String(r.points).padStart(6)} XP  ${r.sessions} sign-in(s)  joined ${r.created_at.toISOString().slice(0, 10)}  ${marks.join(" ")}`
        );
      }
      break;
    }
    case "unlock": {
      const user = await findUser(positional[0]);
      await q("update users set failed_logins = 0, locked_until = null where id = $1", [user.id]);
      console.log(`${user.username} unlocked.`);
      break;
    }
    case "admin": {
      const user = await findUser(positional[0]);
      const on = positional[1];
      if (on !== "on" && on !== "off") fail('Say "on" or "off" after the username.');
      await q("update users set is_admin = $2 where id = $1", [user.id, on === "on"]);
      console.log(`${user.username} admin: ${on}.`);
      break;
    }
    case "disable":
    case "enable": {
      const user = await findUser(positional[0]);
      await q("update users set disabled = $2 where id = $1", [user.id, command === "disable"]);
      if (command === "disable") await q("delete from sessions where user_id = $1", [user.id]);
      console.log(`${user.username} ${command}d.`);
      break;
    }
    case "invites": {
      const { rows } = await q(
        "select note, is_admin, reset_user_id, created_at, expires_at from invites where used_at is null and expires_at > now() order by created_at"
      );
      if (!rows.length) console.log("No unused codes.");
      for (const r of rows)
        console.log(
          `${(r.note || "(no note)").padEnd(32)} ${r.reset_user_id ? "reset " : r.is_admin ? "admin " : "invite"}  made ${r.created_at.toISOString().slice(0, 10)}  expires ${r.expires_at.toISOString().slice(0, 10)}`
        );
      break;
    }
    case "check":
    case "import":
    case "update": {
      if (!positional.length) fail("Give one or more course files.");
      for (const file of positional) {
        const course = JSON.parse(readFileSync(file, "utf8"));
        if (command === "check") {
          const errors = checkCourse(course);
          console.log(errors.length ? `${file}: ${errors.length} problem(s)\n  ${errors.join("\n  ")}` : `${file}: OK`);
          if (errors.length) process.exitCode = 1;
        } else if (command === "import") {
          const r = await importCourse(pool, course);
          console.log(`${file}: added "${course.title}" (${r.units} units, ${r.lessons} lessons, ${r.challenges} challenges${r.solutions ? `, ${r.solutions} new solution versions` : ""}).`);
        } else {
          const r = await updateCourse(pool, course);
          console.log(`${file}: updated "${course.title}" (${r.units} units, ${r.lessons} lessons, ${r.challenges} challenges${r.solutions ? `, ${r.solutions} new solution versions` : ""}).`);
        }
      }
      break;
    }
    default:
      console.log(HELP);
      if (command && command !== "help") process.exitCode = 1;
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

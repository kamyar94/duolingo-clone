import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";

// Serves your own course pictures, audio and video from the media folder (mounted read-only),
// only to signed-in people. Use them in a course as "/media/<file name>". The turbopackIgnore
// comments stop Next from tracing the whole project into the server build because of these paths.
const MEDIA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR ?? "/media");

const TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".vtt": "text/vtt",
  ".pdf": "application/pdf",
};

const notFound = () => new NextResponse("Not found.", { status: 404 });

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) => {
  if (!(await getCurrentUser()))
    return new NextResponse("Unauthorized.", { status: 401 });

  const { path: parts } = await params;
  const type = TYPES[path.extname(parts.at(-1) ?? "").toLowerCase()];
  if (!type) return notFound();

  let file: string;
  let size: number;
  try {
    file = await realpath(path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ...parts));
    if (!file.startsWith(MEDIA_DIR + path.sep)) return notFound();
    const info = await stat(file);
    if (!info.isFile()) return notFound();
    size = info.size;
  } catch {
    return notFound();
  }

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    // Pictures and documents can never run scripts on this site.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };

  // Byte ranges, which phones need to play and seek audio and video.
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && size > 0) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else if (range[2]) {
      start = Math.max(size - Number(range[2]), 0);
    }
    if (start > end || start >= size)
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);

  if (size === 0) return new NextResponse(null, { status, headers });

  const stream = Readable.toWeb(
    createReadStream(file, { start, end })
  ) as ReadableStream;

  return new NextResponse(stream, { status, headers });
};

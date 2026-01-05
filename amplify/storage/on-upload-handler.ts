import type { S3Handler } from "aws-lambda";
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({});

// Upload location (from UI)
const INCOMING_PREFIX = "public/incoming/";

// Final folder users browse
const DEST_PREFIX = "public/UploadedProgramFiles/";

// Only used when there is a collision
const VERSION_PREFIX = "v1";

// ---------- helpers ----------
function basename(key: string) {
  const parts = key.split("/");
  return parts[parts.length - 1] || "file";
}

function splitNameAndExt(filename: string): { base: string; ext: string } {
  // Keep the extension (".docx") if present; handle files with no extension
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return { base: filename, ext: "" }; // dotfiles or no extension
  return {
    base: filename.slice(0, lastDot),
    ext: filename.slice(lastDot),
  };
}

function timestampSuffix() {
  // YYYYMMDD_HHMMSS
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// CopySource must be URL-encoded but keep "/" separators
function copySourceValue(bucket: string, key: string) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${bucket}/${encodedKey}`;
}

async function exists(bucket: string, key: string) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;

    const rawKey = record.s3.object.key; // URL-encoded by S3
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));

    // Only process uploads into public/incoming/
    if (!key.startsWith(INCOMING_PREFIX)) continue;

    // Prevent recursion (copying into DEST triggers onUpload too)
    if (key.startsWith(DEST_PREFIX)) continue;

    const originalName = basename(key);
    const { base, ext } = splitNameAndExt(originalName);

    // 1) Default target = same filename (no suffix)
    let newKey = `${DEST_PREFIX}${originalName}`;

    // 2) Only if collision, append version+timestamp at end (before extension)
    if (await exists(bucket, newKey)) {
      const ts = timestampSuffix();
      newKey = `${DEST_PREFIX}${base}_${VERSION_PREFIX}_${ts}${ext}`;

      // Extra safety if *that* also exists (rare)
      if (await exists(bucket, newKey)) {
        const rand = Math.random().toString(16).slice(2, 8);
        newKey = `${DEST_PREFIX}${base}_${VERSION_PREFIX}_${ts}_${rand}${ext}`;
      }
    }

    // Copy -> Delete (rename/move)
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: copySourceValue(bucket, key),
        Key: newKey,
      })
    );

    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

    console.log(`Moved: s3://${bucket}/${key} -> s3://${bucket}/${newKey}`);
  }
};

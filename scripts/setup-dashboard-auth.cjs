const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { parseEnv } = require("node:util");

const file = path.resolve(__dirname, "../.env");
let source = fs.readFileSync(file, "utf8");
const env = parseEnv(source);
const values = {};
for (const key of ["API_VIEWER_TOKEN", "API_OPERATOR_TOKEN", "JWT_SECRET"]) {
  const current = env[key]?.trim();
  values[key] =
    current && current.length >= 32 && !current.startsWith("change-me")
      ? current
      : randomBytes(32).toString("hex");
}
if (values.API_VIEWER_TOKEN === values.API_OPERATOR_TOKEN)
  throw new Error("Viewer and operator credentials must differ");
values.API_ALLOWED_ORIGINS = [
  ...new Set([
    ...(env.API_ALLOWED_ORIGINS || "").split(",").filter(Boolean),
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3000"
  ])
].join(",");
const newline = source.includes("\r\n") ? "\r\n" : "\n";
for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${key}=.*$`, "gm");
  const line = `${key}=${JSON.stringify(value)}`;
  if (pattern.test(source)) source = source.replace(pattern, () => line);
  else source += `${source.endsWith("\n") ? "" : newline}${line}${newline}`;
}
fs.writeFileSync(file, source);
console.log("Dashboard credentials configured in ignored .env; no secrets printed.");

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");

function walkJsFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".js")) {
      out.push(fullPath);
    }
  }
  return out;
}

function hasUtf8Bom(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error("Missing src directory.");
    process.exit(1);
  }

  const jsFiles = walkJsFiles(SRC_DIR).sort((a, b) => a.localeCompare(b));
  const issues = [];

  for (const filePath of jsFiles) {
    const raw = fs.readFileSync(filePath);
    const text = raw.toString("utf8");
    const fileLabel = rel(filePath);

    if (hasUtf8Bom(raw)) {
      issues.push(`${fileLabel}: has UTF-8 BOM`);
    }

    if (text.includes("\uFFFD")) {
      issues.push(`${fileLabel}: contains replacement char U+FFFD`);
    }

    if (text.includes("`r`n")) {
      issues.push(`${fileLabel}: contains literal \`r\`n`);
    }

    const check = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
    if (check.status !== 0) {
      const errorText = (check.stderr || check.stdout || "").trim();
      issues.push(`${fileLabel}: syntax check failed\n${errorText}`);
    }
  }

  if (issues.length > 0) {
    console.error("Code health check failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`Code health check passed (${jsFiles.length} files).`);
}

main();

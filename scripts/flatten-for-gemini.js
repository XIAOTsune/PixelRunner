#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_FILE = 'gemini_flattened.md';
const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.idea',
  '.vscode',
  'gemini_flat',
]);

const DEFAULT_IGNORE_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'gemini_flattened.txt',
  'gemini_flattened.md',
]);

const DEFAULT_INCLUDE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.css', '.scss', '.sass', '.less',
  '.html', '.htm',
  '.json', '.md', '.txt',
  '.yml', '.yaml', '.toml', '.ini',
  '.xml', '.svg',
  '.sh', '.ps1', '.bat', '.cmd',
  '.py', '.java', '.go', '.rs', '.php', '.rb',
  '.c', '.h', '.cpp', '.hpp',
]);

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    outputFile: DEFAULT_OUTPUT_FILE,
    includeAllText: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--out' && argv[i + 1]) {
      options.outputFile = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--root' && argv[i + 1]) {
      options.root = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === '--all-text') {
      options.includeAllText = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  options.outputPath = path.resolve(options.root, options.outputFile);
  return options;
}

function printHelp() {
  console.log(`\nflatten-for-gemini\n\nUsage:\n  node scripts/flatten-for-gemini.js [--out <file>] [--root <path>] [--all-text] [--dry-run]\n\nOptions:\n  --out <file>     Output file path (default: ${DEFAULT_OUTPUT_FILE})\n  --root <path>    Project root path (default: current directory)\n  --all-text       Include all text files (not only common code extensions)\n  --dry-run        Preview files without writing output\n  -h, --help       Show this help\n`);
}

function isBinaryBuffer(buffer) {
  if (buffer.length === 0) return false;

  let suspicious = 0;
  const sampleLength = Math.min(buffer.length, 1024);

  for (let i = 0; i < sampleLength; i += 1) {
    const byte = buffer[i];
    if (byte === 0) return true;

    const isControl = (byte < 7) || (byte > 14 && byte < 32);
    const isExtended = byte > 126;
    const isWhitespace = byte === 9 || byte === 10 || byte === 13;

    if ((isControl || isExtended) && !isWhitespace) {
      suspicious += 1;
    }
  }

  return (suspicious / sampleLength) > 0.3;
}

function isTextFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
    fs.closeSync(fd);
    return !isBinaryBuffer(buffer.subarray(0, bytesRead));
  } catch {
    return false;
  }
}

function shouldIncludeFile(filePath, includeAllText) {
  const ext = path.extname(filePath).toLowerCase();

  if (DEFAULT_INCLUDE_EXTENSIONS.has(ext)) {
    return true;
  }

  if (!includeAllText) {
    return false;
  }

  return isTextFile(filePath);
}

function walk(dirPath, options, files = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      walk(fullPath, options, files);
      continue;
    }

    if (DEFAULT_IGNORE_FILES.has(entry.name)) {
      continue;
    }

    if (path.resolve(fullPath) === options.outputPath) {
      continue;
    }

    if (shouldIncludeFile(fullPath, options.includeAllText)) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeLineEndings(content) {
  return content.replace(/\r\n/g, '\n');
}

function detectCodeFenceLang(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  const extToLang = {
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.html': 'html',
    '.htm': 'html',
    '.json': 'json',
    '.md': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.xml': 'xml',
    '.svg': 'xml',
    '.sh': 'bash',
    '.ps1': 'powershell',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.php': 'php',
    '.rb': 'ruby',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
  };
  return extToLang[ext] || '';
}

function createBlock(relativePath, content) {
  const lang = detectCodeFenceLang(relativePath);
  return [
    `## ${relativePath}`,
    '',
    `\`\`\`${lang}`,
    content,
    '```',
    '',
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  const fileList = walk(options.root, options)
    .map((absPath) => path.relative(options.root, absPath).replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b));

  if (options.dryRun) {
    console.log(`Would merge ${fileList.length} files into: ${options.outputPath}`);
    for (const rel of fileList) {
      console.log(rel);
    }
    return;
  }

  const blocks = [];
  blocks.push('# Gemini Flattened Code Export');
  blocks.push('');
  blocks.push(`- GeneratedAt: ${new Date().toISOString()}`);
  blocks.push(`- Root: ${options.root}`);
  blocks.push(`- FileCount: ${fileList.length}`);
  blocks.push('');
  blocks.push('## File Index');
  blocks.push('');
  for (const relPath of fileList) {
    blocks.push(`- \`${relPath}\``);
  }
  blocks.push('');

  for (const relPath of fileList) {
    const absPath = path.resolve(options.root, relPath);
    const raw = fs.readFileSync(absPath, 'utf8');
    const normalized = normalizeLineEndings(raw);
    blocks.push(createBlock(relPath, normalized));
  }

  fs.writeFileSync(options.outputPath, `${blocks.join('\n')}\n`, 'utf8');
  console.log(`Merged ${fileList.length} files into: ${options.outputPath}`);
}

main();

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist-chrome',
  'dist-edge',
  'dev-chrome',
  'dev-edge',
  '_locales',
  'screenshots',
  'scripts'
];

const INCLUDE_EXTENSIONS = ['.js', '.html', '.json'];

function log(message, color = 'white') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function readEnglishMessages() {
  try {
    const messagesPath = path.join(__dirname, '..', 'src', '_locales', 'en', 'messages.json');
    const content = fs.readFileSync(messagesPath, 'utf8');
    const messages = JSON.parse(content);
    return Object.keys(messages);
  } catch (error) {
    log(`❌ Error reading English messages.json: ${error.message}`, 'red');
    process.exit(1);
  }
}

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(file)) {
        getAllFiles(filePath, fileList);
      }
    } else {
      const ext = path.extname(file);
      if (INCLUDE_EXTENSIONS.includes(ext)) {
        fileList.push(filePath);
      }
    }
  });

  return fileList;
}

function getSourceFiles(dir) {
  const srcDir = path.join(dir, 'src');
  if (!fs.existsSync(srcDir)) return [];

  const EXCLUDE_SRC = ['_locales', '__tests__', 'node_modules'];
  const results = [];

  function walk(d) {
    const files = fs.readdirSync(d);
    files.forEach(file => {
      const filePath = path.join(d, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        if (!EXCLUDE_SRC.includes(file)) walk(filePath);
      } else {
        const ext = path.extname(file);
        if (['.js', '.html'].includes(ext)) results.push(filePath);
      }
    });
  }

  walk(srcDir);
  return results;
}

function searchInFile(filePath, searchKey) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    const patterns = [
      new RegExp(`chrome\\.i18n\\.getMessage\\(\\s*['"\`]${searchKey}['"\`]`, 'g'),
      new RegExp(`getMessage\\(\\s*['"\`]${searchKey}['"\`]`, 'g'),
      new RegExp(`__MSG_${searchKey}__`, 'g'),
      new RegExp(`data-i18n\\s*=\\s*['"\`]${searchKey}['"\`]`, 'g'),
      new RegExp(`data-i18n-title\\s*=\\s*['"\`]${searchKey}['"\`]`, 'g'),
      new RegExp(`data-i18n-alt\\s*=\\s*['"\`]${searchKey}['"\`]`, 'g'),
      new RegExp(`data-i18n-placeholder\\s*=\\s*['"\`]${searchKey}['"\`]`, 'g'),
      new RegExp(`data-i18n-aria-label\\s*=\\s*['"\`]${searchKey}['"\`]`, 'g'),
      new RegExp(`['"\`]${searchKey}['"\`]`, 'g'),
    ];

    return patterns.some(pattern => pattern.test(content));
  } catch (error) {
    return false;
  }
}

function checkStringUsage(messageKeys, allFiles) {
  const unusedStrings = [];
  const usedStrings = [];

  log('🔍 Checking string usage across the codebase...', 'blue');

  messageKeys.forEach((key, index) => {
    if (index % 10 === 0) {
      process.stdout.write(`\r${colors.cyan}Progress: ${index}/${messageKeys.length} (${Math.round(index/messageKeys.length*100)}%)${colors.reset}`);
    }

    let found = false;

    for (const filePath of allFiles) {
      if (searchInFile(filePath, key)) {
        found = true;
        usedStrings.push(key);
        break;
      }
    }

    if (!found) {
      unusedStrings.push(key);
    }
  });

  process.stdout.write('\r' + ' '.repeat(50) + '\r');

  return { unusedStrings, usedStrings };
}

function checkHardcodedStrings(sourceFiles) {
  const hardcodedIssues = [];
  const projectRoot = path.join(__dirname, '..');

  log('🔍 Checking for hardcoded strings in source files...', 'blue');

  sourceFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(projectRoot, filePath);
      const ext = path.extname(filePath);
      const lines = content.split('\n');

      if (ext === '.html') {
        lines.forEach((line, lineNum) => {
          // Hardcoded aria-label without data-i18n-aria-label
          const ariaLabelMatch = line.match(/aria-label="([^"]+)"/);
          if (ariaLabelMatch && !/data-i18n-aria-label/.test(line)) {
            const val = ariaLabelMatch[1];
            if (/[a-zA-Z]{2,}/.test(val) && !/^[A-Z][a-z]+$/.test(val)) {
              hardcodedIssues.push({
                file: relativePath,
                line: lineNum + 1,
                found: `aria-label="${val}"`,
                message: 'Hardcoded aria-label without data-i18n-aria-label',
                suggestion: 'Add data-i18n-aria-label attribute with an i18n key'
              });
            }
          }

          // Hardcoded alt without data-i18n-alt (only for English text, not empty alts)
          const altMatch = line.match(/alt="([^"]+)"/);
          if (altMatch && !/data-i18n-alt/.test(line)) {
            const val = altMatch[1];
            if (/[a-zA-Z]{3,}/.test(val) && val !== 'BirdTab') {
              hardcodedIssues.push({
                file: relativePath,
                line: lineNum + 1,
                found: `alt="${val}"`,
                message: 'Hardcoded alt text without data-i18n-alt',
                suggestion: 'Add data-i18n-alt attribute with an i18n key'
              });
            }
          }
        });
      }

      if (ext === '.js') {
        const isDebugFile = /debug/i.test(filePath);

        lines.forEach((line, lineNum) => {
          const trimmed = line.trim();

          // Skip comments, imports, console/log statements
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
          if (/^\s*(import|export)\s/.test(trimmed)) return;
          if (/\b(console\.(log|warn|error|info|debug)|log)\s*\(/.test(trimmed)) return;
          if (/process\.env/.test(trimmed)) return;


          // innerHTML/textContent with hardcoded alt="English text"
          const altInJs = trimmed.match(/alt="([A-Z][a-z]{2,}[^"]*?)"/g);
          if (altInJs) {
            altInJs.forEach(match => {
              const val = match.match(/alt="([^"]+)"/)[1];
              if (/getMessage|chrome\.i18n|data-i18n-alt/.test(trimmed)) return;
              hardcodedIssues.push({
                file: relativePath,
                line: lineNum + 1,
                found: match,
                message: 'Hardcoded alt text in JS template',
                suggestion: 'Use getMessage() or chrome.i18n.getMessage() for alt text'
              });
            });
          }

          // Hardcoded aria-label="..." in JS without i18n
          const ariaInJs = trimmed.match(/aria-label="([A-Z][a-z]{2,}[^"]*?)"/g);
          if (ariaInJs) {
            ariaInJs.forEach(match => {
              if (/getMessage|chrome\.i18n|data-i18n/.test(trimmed)) return;
              hardcodedIssues.push({
                file: relativePath,
                line: lineNum + 1,
                found: match,
                message: 'Hardcoded aria-label in JS template',
                suggestion: 'Use getMessage() or chrome.i18n.getMessage() for aria-label'
              });
            });
          }

          // .textContent = 'English text' (multi-word, starts with capital)
          const textContentMatch = trimmed.match(/\.textContent\s*=\s*['"`]([A-Z][a-z]+(?:\s+[a-z]+)+)['"`]/);
          if (textContentMatch) {
            if (!/getMessage|chrome\.i18n/.test(trimmed)) {
              hardcodedIssues.push({
                file: relativePath,
                line: lineNum + 1,
                found: textContentMatch[0],
                message: 'Hardcoded textContent assignment',
                suggestion: 'Use getMessage() for user-visible text'
              });
            }
          }

          // .innerText = 'English text'
          const innerTextMatch = trimmed.match(/\.innerText\s*=\s*['"`]([A-Z][a-z]+(?:\s+[a-z]+)+)['"`]/);
          if (innerTextMatch) {
            if (!/getMessage|chrome\.i18n/.test(trimmed)) {
              hardcodedIssues.push({
                file: relativePath,
                line: lineNum + 1,
                found: innerTextMatch[0],
                message: 'Hardcoded innerText assignment',
                suggestion: 'Use getMessage() for user-visible text'
              });
            }
          }

          // alert('English text') or confirm('English text')
          const alertMatch = trimmed.match(/\b(alert|confirm)\s*\(\s*['"`]([A-Z][a-z].*?)['"`]\s*\)/);
          if (alertMatch) {
            if (!/getMessage|chrome\.i18n/.test(trimmed)) {
              hardcodedIssues.push({
                file: relativePath,
                line: lineNum + 1,
                found: alertMatch[0],
                message: `Hardcoded ${alertMatch[1]}() message`,
                suggestion: 'Use getMessage() for dialog text'
              });
            }
          }
        });
      }
    } catch (error) {
      // Skip files that can't be read
    }
  });

  // Filter out findings that are in debug/dev-only context
  return hardcodedIssues.filter(issue => {
    try {
      const fullPath = path.join(projectRoot, issue.file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      const lineIdx = issue.line - 1;

      // Check if this line is inside a function with "debug" or "Debug" in the name
      for (let i = lineIdx; i >= Math.max(0, lineIdx - 50); i--) {
        const l = lines[i];
        if (/\b(bindDebug|setupDebug|initDebug|debugShow|updateDebug)\w*\s*\(/.test(l)) return false;
        if (/process\.env\.NODE_ENV\s*===?\s*['"]development['"]/.test(l)) return false;
      }
      return true;
    } catch {
      return true;
    }
  });
}

function main() {
  log('🧹 Unused Translation Strings Checker', 'bold');
  log('=====================================\n', 'bold');

  const messageKeys = readEnglishMessages();
  log(`📋 Found ${messageKeys.length} translation strings in English messages.json\n`, 'green');

  const projectRoot = path.join(__dirname, '..');
  const allFiles = getAllFiles(projectRoot);
  log(`📁 Searching in ${allFiles.length} files...\n`, 'blue');

  const { unusedStrings, usedStrings } = checkStringUsage(messageKeys, allFiles);

  const sourceFiles = getSourceFiles(projectRoot);
  const hardcodedIssues = checkHardcodedStrings(sourceFiles);

  log('\n📊 USAGE REPORT:', 'bold');
  log('================\n', 'bold');

  if (unusedStrings.length === 0) {
    log('✅ All translation strings are being used!', 'green');
  } else {
    log(`⚠️  Found ${unusedStrings.length} potentially unused strings:`, 'yellow');
    log(`✅ ${usedStrings.length} strings are actively used\n`, 'green');

    log('🔍 POTENTIALLY UNUSED STRINGS:', 'red');
    log('===============================', 'red');

    unusedStrings.forEach((key, index) => {
      log(`${index + 1}. ${key}`, 'red');
    });

    log('\n💡 NOTE:', 'yellow');
    log('These strings might be:', 'yellow');
    log('• Actually unused and can be removed', 'yellow');
    log('• Used in a way not detected by this script', 'yellow');
    log('• Reserved for future features', 'yellow');
    log('• Used dynamically (e.g., computed key names)', 'yellow');
    log('\nPlease manually verify before removing any strings.', 'yellow');
  }

  if (hardcodedIssues.length > 0) {
    log('\n🚨 HARDCODED STRINGS FOUND:', 'red');
    log('============================', 'red');

    hardcodedIssues.forEach((issue, index) => {
      log(`\n${index + 1}. ${issue.file}:${issue.line}`, 'yellow');
      log(`   ${issue.message}`, 'red');
      log(`   Found: ${issue.found}`, 'cyan');
      log(`   💡 ${issue.suggestion}`, 'green');
    });

    log('\n⚠️  These hardcoded strings should be replaced with i18n calls.', 'yellow');
  } else {
    log('\n✅ No hardcoded strings detected!', 'green');
  }

  log(`\n📈 SUMMARY:`, 'bold');
  log(`✅ Used: ${usedStrings.length}/${messageKeys.length} (${Math.round(usedStrings.length/messageKeys.length*100)}%)`, 'green');
  log(`⚠️  Potentially unused: ${unusedStrings.length}/${messageKeys.length} (${Math.round(unusedStrings.length/messageKeys.length*100)}%)`, unusedStrings.length > 0 ? 'yellow' : 'green');
  log(`🚨 Hardcoded strings: ${hardcodedIssues.length}`, hardcodedIssues.length > 0 ? 'red' : 'green');

  const hasIssues = unusedStrings.length > 0 || hardcodedIssues.length > 0;
  process.exit(hasIssues ? 1 : 0);
}

main();

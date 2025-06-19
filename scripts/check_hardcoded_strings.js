#!/usr/bin/env node

/**
 * Script to check for hardcoded English strings that should be internationalized
 * 
 * This script scans JavaScript, HTML, and CSS files for hardcoded English text
 * that should be replaced with internationalization functions like chrome.i18n.getMessage()
 * 
 * Features:
 * - Detects hardcoded strings in regular assignments and innerHTML
 * - Skips log functions and console messages (developer-only)
 * - Supports special skip flags to ignore specific code sections
 * - Provides categorized output with helpful suggestions
 * 
 * Skip Flags:
 * Use // @skip-hardcoded-check to start skipping a section
 * Use // @end-skip-hardcoded-check to end skipping a section
 * 
 * Usage: node check_hardcoded_strings.js [file_or_directory]
 */

const fs = require('fs');
const path = require('path');

// Directories to scan (user-facing code only)
const scanDirs = ['src'];

// File extensions to check
const extensions = ['.js', '.html', '.css'];

// Patterns to detect hardcoded English strings
const patterns = [
  // String literals in quotes
  /"[A-Z][a-zA-Z\s,.'!?-]{10,}"/g,
  /'[A-Z][a-zA-Z\s,.'!?-]{10,}'/g,
  // Template literals with English text
  /`[A-Z][a-zA-Z\s,.'!?-]{10,}`/g,
  // innerHTML with English text (comprehensive patterns)
  /innerHTML\s*=\s*["'`][^"'`]*[A-Z][a-zA-Z\s,.'!?-]{10,}[^"'`]*["'`]/g,
  /innerHTML\s*=\s*["'`][^"'`]*<[^>]*>[A-Z][a-zA-Z\s,.'!?-]{5,}<\/[^>]*>[^"'`]*["'`]/g,
  /innerHTML\s*\+=\s*["'`][^"'`]*[A-Z][a-zA-Z\s,.'!?-]{5,}[^"'`]*["'`]/g,
  // innerHTML with template literals containing hardcoded text
  /innerHTML\s*=\s*`[^`]*[A-Z][a-zA-Z\s,.'!?-]{5,}[^`]*`/g,
  /innerHTML\s*\+=\s*`[^`]*[A-Z][a-zA-Z\s,.'!?-]{5,}[^`]*`/g,
  // textContent with English text
  /textContent\s*=\s*["'`][A-Z][a-zA-Z\s,.'!?-]{10,}["'`]/g,
  // innerText with English text
  /innerText\s*=\s*["'`][A-Z][a-zA-Z\s,.'!?-]{10,}["'`]/g,
  // Common UI text patterns
  /["'`](Add|Edit|Delete|Remove|Save|Cancel|OK|Close|Settings|Error|Warning|Success)[^"'`]*["'`]/g,
];

// Whitelist of allowed patterns (legitimate English that shouldn't be translated)
const whitelist = [
  // Technical terms
  /chrome\.i18n\./,
  /__MSG_\w+__/,
  /@@\w+/,
  // URLs and domains
  /https?:\/\/[^\s"'`]+/,
  /\.com|\.org|\.net/,
  // Code identifiers
  /getElementById|querySelector|addEventListener/,
  // API names
  /topSites|favicon|permissions/,
  // File paths and extensions
  /\.(js|css|html|json|png|jpg|svg)/,
  // Console/debug messages (developers only)
  /console\.(log|error|warn)/,
  // Log function calls (developers only)
  /log\s*\(/,
  // Library names
  /Macaulay Library|Chrome|BirdTab/,
  // CSS classes and IDs
  /class\s*=|id\s*=/,
  // innerHTML that already uses i18n functions
  /innerHTML.*chrome\.i18n\.getMessage/,
  /innerHTML.*\$\{chrome\.i18n\.getMessage/,
  // Template literals that use i18n
  /`.*\$\{chrome\.i18n\.getMessage.*`/,
];

function shouldIgnoreLine(line) {
  return whitelist.some(pattern => pattern.test(line));
}

function hasI18nAttribute(line) {
  // Check if the line contains i18n attributes
  const i18nAttributes = [
    /data-i18n\s*=\s*["'][^"']*["']/,
    /data-i18n-placeholder\s*=\s*["'][^"']*["']/,
    /data-i18n-title\s*=\s*["'][^"']*["']/,
    /data-i18n-text\s*=\s*["'][^"']*["']/,
    /data-i18n-value\s*=\s*["'][^"']*["']/,
    /data-i18n-label\s*=\s*["'][^"']*["']/,
    /chrome\.i18n\.getMessage\s*\(/,
    /__MSG_\w+__/
  ];
  
  return i18nAttributes.some(pattern => pattern.test(line));
}

function isPartOfI18nElement(lines, currentIndex) {
  // Check if the current line is part of an HTML element that has i18n attributes
  // Look backwards to find the opening tag
  let openingTagIndex = currentIndex;
  while (openingTagIndex >= 0) {
    const line = lines[openingTagIndex];
    if (line.includes('<') && !line.trim().startsWith('<!--')) {
      // Found an opening tag, check if it has i18n attributes
      let elementContent = line;
      let checkIndex = openingTagIndex;
      
      // Collect the full element (might span multiple lines)
      while (checkIndex <= currentIndex && !elementContent.includes('>')) {
        checkIndex++;
        if (checkIndex < lines.length) {
          elementContent += lines[checkIndex];
        }
      }
      
      // Check if this element has i18n attributes
      if (hasI18nAttribute(elementContent)) {
        return true;
      }
      
      // If we found a complete tag but no i18n attributes, this is the element
      if (elementContent.includes('>')) {
        break;
      }
    }
    openingTagIndex--;
  }
  
  return false;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];
  let skipHardcodedCheck = false;

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // Check for special skip flags
    if (trimmedLine.includes('// @skip-hardcoded-check')) {
      skipHardcodedCheck = true;
      return;
    }
    if (trimmedLine.includes('// @end-skip-hardcoded-check')) {
      skipHardcodedCheck = false;
      return;
    }
    
    // If we're in a skip section, don't check this line
    if (skipHardcodedCheck) {
      return;
    }
    
    // Skip comments and empty lines
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || 
        trimmedLine.startsWith('*') || trimmedLine.startsWith('<!--') || 
        trimmedLine === '') {
      return;
    }

    // Skip whitelisted patterns
    if (shouldIgnoreLine(line)) {
      return;
    }

    // Skip lines that have i18n attributes (already internationalized)
    if (hasI18nAttribute(line)) {
      return;
    }

    // For HTML files, check if this is part of an element with i18n attributes
    if (filePath.endsWith('.html') && isPartOfI18nElement(lines, index)) {
      return;
    }

    // Check for hardcoded strings
    patterns.forEach(pattern => {
      const matches = line.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Additional filtering for false positives
          if (!shouldIgnoreMatch(match)) {
            issues.push({
              line: index + 1,
              text: match.trim(),
              context: trimmedLine
            });
          }
        });
      }
    });

    // Special check for innerHTML assignments with hardcoded text
    if (isInnerHTMLWithHardcodedText(line)) {
      // Extract the innerHTML assignment part
      const innerHTMLMatch = line.match(/(\.?innerHTML\s*[+]?=\s*["'`][^"'`]*["'`]|\.?innerHTML\s*=\s*`[^`]*`)/);
      if (innerHTMLMatch && !hasI18nAttribute(line)) {
        issues.push({
          line: index + 1,
          text: innerHTMLMatch[0].trim(),
          context: trimmedLine,
          type: 'innerHTML_hardcoded'
        });
      }
    }
  });

  return issues;
}

function isInnerHTMLWithHardcodedText(line) {
  // More sophisticated innerHTML detection
  const innerHTMLPatterns = [
    // Basic innerHTML assignments with hardcoded text
    /\.innerHTML\s*=\s*["'`][^"'`]*[A-Z][a-zA-Z\s,.'!?()-]{4,}[^"'`]*["'`]/,
    // innerHTML with HTML tags containing text
    /\.innerHTML\s*=\s*["'`][^"'`]*<[^>]*>[A-Z][a-zA-Z\s,.'!?()-]{3,}<\/[^>]*>[^"'`]*["'`]/,
    // innerHTML concatenation
    /\.innerHTML\s*\+=\s*["'`][^"'`]*[A-Z][a-zA-Z\s,.'!?()-]{4,}[^"'`]*["'`]/,
    // Template literal innerHTML
    /\.innerHTML\s*=\s*`[^`]*[A-Z][a-zA-Z\s,.'!?()-]{4,}[^`]*`/,
    // Element.innerHTML without the dot (direct assignment)
    /innerHTML\s*=\s*["'`][^"'`]*[A-Z][a-zA-Z\s,.'!?()-]{4,}[^"'`]*["'`]/,
    /innerHTML\s*=\s*`[^`]*[A-Z][a-zA-Z\s,.'!?()-]{4,}[^`]*`/,
  ];
  
  return innerHTMLPatterns.some(pattern => pattern.test(line));
}

function shouldIgnoreMatch(match) {
  const ignorePatterns = [
    // CSS values and properties
    /^["'`](left|right|center|top|bottom|auto|none|block|inline|absolute|relative)["'`]$/,
    // Short technical strings
    /^["'`]\w{1,3}["'`]$/,
    // Numbers and units
    /^\d+(\.\d+)?(px|em|rem|%)?$/,
    // Color codes
    /#[0-9a-fA-F]{3,6}/,
    // HTML attributes and tags (technical)
    /^["'`](class|id|href|src|alt|title|data-\w+)["'`]$/,
    // Common HTML tag names
    /^["'`](div|span|p|h1|h2|h3|button|input|img)["'`]$/,
  ];

  // Single words that might be technical
  if (/^["'`]\w+["'`]$/.test(match) && match.length < 8) {
    return true;
  }

  return ignorePatterns.some(pattern => pattern.test(match));
}

function scanDirectory(dir) {
  const results = {};
  
  function walkDir(currentDir) {
    const items = fs.readdirSync(currentDir);
    
    items.forEach(item => {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Skip node_modules, build output, etc.
        if (!['node_modules', 'dist', 'build', '.git', 'scripts'].includes(item)) {
          walkDir(fullPath);
        }
      } else if (stat.isFile()) {
        const ext = path.extname(item);
        if (extensions.includes(ext)) {
          const issues = scanFile(fullPath);
          if (issues.length > 0) {
            results[fullPath] = issues;
          }
        }
      }
    });
  }
  
  walkDir(dir);
  return results;
}

function checkHardcodedStrings() {
  console.log('🔍 Checking for hardcoded English strings in user-facing code...\n');
  
  let totalIssues = 0;
  const allResults = {};
  
  scanDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      const results = scanDirectory(dir);
      Object.assign(allResults, results);
    }
  });
  
  console.log('📊 HARDCODED STRINGS REPORT:\n');
  
  if (Object.keys(allResults).length === 0) {
    console.log('✅ No hardcoded English strings found! Perfect i18n coverage.\n');
    return true;
  }
  
  Object.entries(allResults).forEach(([filePath, issues]) => {
    console.log(`⚠️  ${filePath}:`);
    issues.forEach(issue => {
      const typeIndicator = issue.type === 'innerHTML_hardcoded' ? '🏷️  innerHTML' : '📝 String';
      console.log(`   ${typeIndicator} - Line ${issue.line}: ${issue.text}`);
      console.log(`   Context: ${issue.context}`);
      if (issue.type === 'innerHTML_hardcoded') {
        console.log(`   💡 Suggestion: Use chrome.i18n.getMessage() inside the innerHTML assignment`);
      }
      console.log('');
      totalIssues++;
    });
  });
  
  console.log(`📈 SUMMARY:`);
  console.log(`❌ Found ${totalIssues} potential hardcoded strings in ${Object.keys(allResults).length} files`);
  console.log(`💡 These strings should be moved to _locales/en/messages.json and replaced with chrome.i18n.getMessage() calls\n`);
  
  return false;
}

// Run the check
if (require.main === module) {
  const isClean = checkHardcodedStrings();
  process.exit(isClean ? 0 : 1);
}

module.exports = { checkHardcodedStrings };
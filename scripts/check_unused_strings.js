#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// ANSI color codes for console output
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

// Directories to exclude from search
const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist-chrome',
  'dist-edge',
  'dev-chrome',
  '_locales',
  'screenshots'
];

// File extensions to search in
const INCLUDE_EXTENSIONS = ['.js', '.html', '.css', '.json'];

function log(message, color = 'white') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function readEnglishMessages() {
  try {
    const messagesPath = path.join(__dirname, '..', 'src', '_locales', 'en', 'messages.json');
    const content = fs.readFileSync(messagesPath, 'utf8');
    const messages = JSON.parse(content);
    
    // Extract just the keys
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
      // Skip excluded directories
      if (!EXCLUDE_DIRS.includes(file)) {
        getAllFiles(filePath, fileList);
      }
    } else {
      // Include only specified file extensions
      const ext = path.extname(file);
      if (INCLUDE_EXTENSIONS.includes(ext)) {
        fileList.push(filePath);
      }
    }
  });
  
  return fileList;
}

function searchInFile(filePath, searchKey) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Multiple search patterns for different ways the key might be used
    const patterns = [
      // Standard chrome.i18n.getMessage calls
      new RegExp(`chrome\\.i18n\\.getMessage\\(\\s*['"\`]${searchKey}['"\`]\\s*\\)`, 'g'),
      // With template literals
      new RegExp(`chrome\\.i18n\\.getMessage\\(\\s*\\\`${searchKey}\\\`\\s*\\)`, 'g'),
      // Chrome extension manifest.json __MSG_ pattern
      new RegExp(`__MSG_${searchKey}__`, 'g'),
      // In HTML data-i18n attributes
      new RegExp(`data-i18n\\s*=\\s*['"\`]${searchKey}['"\`]`, 'g'),
      // As string literal in quotes (common in UI)
      new RegExp(`['"\`]${searchKey}['"\`]`, 'g'),
      // Variable assignments or object properties
      new RegExp(`${searchKey}\\s*[:=]`, 'g'),
      // As object key
      new RegExp(`['"\`]?${searchKey}['"\`]?\\s*:`, 'g')
    ];
    
    // Check if any pattern matches
    return patterns.some(pattern => pattern.test(content));
  } catch (error) {
    // Skip files that can't be read
    return false;
  }
}

function checkStringUsage(messageKeys, allFiles) {
  const unusedStrings = [];
  const usedStrings = [];
  
  log('🔍 Checking string usage across the codebase...', 'blue');
  
  messageKeys.forEach((key, index) => {
    // Show progress
    if (index % 10 === 0) {
      process.stdout.write(`\r${colors.cyan}Progress: ${index}/${messageKeys.length} (${Math.round(index/messageKeys.length*100)}%)${colors.reset}`);
    }
    
    let found = false;
    
    // Search in all files
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
  
  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
  
  return { unusedStrings, usedStrings };
}

function checkHardcodedStrings(allFiles) {
  const hardcodedIssues = [];
  
  // Common hardcoded patterns that should use i18n
  const hardcodedPatterns = [
    {
      pattern: /lang="en"/g,
      message: 'Found hardcoded lang="en", should use __MSG_currentLocale__',
      suggestion: 'Replace with lang="__MSG_currentLocale__"'
    },
    {
      pattern: /"Which bird is this\?"/g,
      message: 'Found hardcoded quiz question text',
      suggestion: 'Use chrome.i18n.getMessage("quizModeQuestion")'
    },
    {
      pattern: /'Which bird is this\?'/g,
      message: 'Found hardcoded quiz question text',
      suggestion: 'Use chrome.i18n.getMessage("quizModeQuestion")'
    },
    {
      pattern: /Question\s+\d+\s+of\s+\d+/g,
      message: 'Found hardcoded progress text',
      suggestion: 'Use chrome.i18n.getMessage("quizProgress")'
    },
    {
      pattern: /Score:\s*\d+\/\d+/g,
      message: 'Found hardcoded score text',
      suggestion: 'Use chrome.i18n.getMessage("quizScore")'
    },
    {
      pattern: /Submit Answer/g,
      message: 'Found hardcoded submit button text',
      suggestion: 'Use chrome.i18n.getMessage("quizSubmitAnswer")'
    }
  ];
  
  log('🔍 Checking for hardcoded strings that should use i18n...', 'blue');
  
  allFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(path.join(__dirname, '..'), filePath);
      
      hardcodedPatterns.forEach(({ pattern, message, suggestion }) => {
        const matches = content.match(pattern);
        if (matches) {
          hardcodedIssues.push({
            file: relativePath,
            matches: matches,
            message: message,
            suggestion: suggestion
          });
        }
      });
    } catch (error) {
      // Skip files that can't be read
    }
  });
  
  return hardcodedIssues;
}

function main() {
  log('🧹 Unused Translation Strings Checker', 'bold');
  log('=====================================\n', 'bold');
  
  // Read English messages
  const messageKeys = readEnglishMessages();
  log(`📋 Found ${messageKeys.length} translation strings in English messages.json\n`, 'green');
  
  // Get all files to search
  const projectRoot = path.join(__dirname, '..');
  const allFiles = getAllFiles(projectRoot);
  log(`📁 Searching in ${allFiles.length} files...\n`, 'blue');
  
  // Check usage
  const { unusedStrings, usedStrings } = checkStringUsage(messageKeys, allFiles);
  
  // Check for hardcoded strings
  const hardcodedIssues = checkHardcodedStrings(allFiles);
  
  // Report results
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
  
  // Report hardcoded strings
  if (hardcodedIssues.length > 0) {
    log('\n🚨 HARDCODED STRINGS FOUND:', 'red');
    log('============================', 'red');
    
    hardcodedIssues.forEach((issue, index) => {
      log(`\n${index + 1}. ${issue.file}:`, 'yellow');
      log(`   ${issue.message}`, 'red');
      log(`   Found: ${issue.matches.join(', ')}`, 'cyan');
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
}

// Run the script
main(); 
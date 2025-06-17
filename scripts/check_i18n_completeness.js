#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Define the languages and their directories
const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'zh', name: 'Chinese Simplified' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' }
];

const localesDir = path.join(__dirname, '..', 'src', '_locales');

function loadMessages(langCode) {
  const messagesPath = path.join(localesDir, langCode, 'messages.json');
  try {
    const content = fs.readFileSync(messagesPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading messages for ${langCode}:`, error.message);
    return {};
  }
}

function checkCompleteness() {
  console.log('🔍 Checking i18n completeness across all languages...\n');
  
  // Load English as the reference
  const englishMessages = loadMessages('en');
  const englishKeys = Object.keys(englishMessages);
  
  console.log(`📋 Reference language (English) has ${englishKeys.length} strings\n`);
  
  const results = {};
  let allComplete = true;
  
  // Check each language
  languages.forEach(lang => {
    const messages = loadMessages(lang.code);
    const keys = Object.keys(messages);
    const missingKeys = englishKeys.filter(key => !messages.hasOwnProperty(key));
    const extraKeys = keys.filter(key => !englishMessages.hasOwnProperty(key));
    
    const completeness = ((keys.length - extraKeys.length) / englishKeys.length * 100).toFixed(1);
    
    results[lang.code] = {
      name: lang.name,
      totalKeys: keys.length,
      missingKeys: missingKeys,
      extraKeys: extraKeys,
      completeness: parseFloat(completeness)
    };
    
    if (missingKeys.length > 0 || extraKeys.length > 0) {
      allComplete = false;
    }
  });
  
  // Display results
  console.log('📊 COMPLETENESS REPORT:\n');
  
  languages.forEach(lang => {
    const result = results[lang.code];
    const statusIcon = result.completeness === 100 && result.extraKeys.length === 0 ? '✅' : '⚠️';
    
    console.log(`${statusIcon} ${result.name} (${lang.code}): ${result.completeness}% complete`);
    console.log(`   Total strings: ${result.totalKeys}`);
    
    if (result.missingKeys.length > 0) {
      console.log(`   ❌ Missing ${result.missingKeys.length} strings:`);
      result.missingKeys.forEach(key => {
        console.log(`      - ${key}`);
      });
    }
    
    if (result.extraKeys.length > 0) {
      console.log(`   ➕ Extra ${result.extraKeys.length} strings (not in English):`);
      result.extraKeys.forEach(key => {
        console.log(`      - ${key}`);
      });
    }
    
    console.log('');
  });
  
  // Summary
  console.log('📈 SUMMARY:');
  const completeLanguages = languages.filter(lang => 
    results[lang.code].completeness === 100 && results[lang.code].extraKeys.length === 0
  );
  
  console.log(`✅ Complete: ${completeLanguages.length}/${languages.length} languages`);
  
  if (completeLanguages.length > 0) {
    console.log(`   ${completeLanguages.map(lang => lang.name).join(', ')}`);
  }
  
  const incompleteLanguages = languages.filter(lang => 
    results[lang.code].completeness !== 100 || results[lang.code].extraKeys.length > 0
  );
  
  if (incompleteLanguages.length > 0) {
    console.log(`⚠️  Need attention: ${incompleteLanguages.length}/${languages.length} languages`);
    console.log(`   ${incompleteLanguages.map(lang => lang.name).join(', ')}`);
  }
  
  return allComplete;
}

// Run the check
if (require.main === module) {
  const isComplete = checkCompleteness();
  process.exit(isComplete ? 0 : 1);
}

module.exports = { checkCompleteness };
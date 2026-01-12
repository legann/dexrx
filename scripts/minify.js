#!/usr/bin/env node

/**
 * Minify all JavaScript files in lib/dexrx/dist using esbuild
 * This script minifies both CJS and ESM builds
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '../lib/dexrx/dist');

/**
 * Recursively find all .js files in a directory
 */
function findJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findJsFiles(filePath, fileList);
    } else if (file.endsWith('.js') && !file.endsWith('.map')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

async function minifyFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Determine format based on file location
    const isESM = filePath.includes('/esm/');
    const format = isESM ? 'esm' : 'cjs';
    
    const result = await esbuild.transform(content, {
      minify: true,
      format: format,
      target: 'es2020',
      keepNames: false, // Allow name mangling for better minification
    });
    
    // Write minified content back to file
    fs.writeFileSync(filePath, result.code, 'utf8');
    
    return { file: filePath, originalSize: content.length, minifiedSize: result.code.length };
  } catch (error) {
    console.error(`Error minifying ${filePath}:`, error.message);
    return null;
  }
}

async function minifyAll() {
  console.log('🔨 Starting minification...\n');
  
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`❌ Dist directory not found: ${DIST_DIR}`);
    process.exit(1);
  }
  
  // Find all .js files in dist
  const jsFiles = findJsFiles(DIST_DIR);
  
  if (jsFiles.length === 0) {
    console.log('⚠️  No JavaScript files found to minify');
    return;
  }
  
  console.log(`Found ${jsFiles.length} JavaScript files to minify\n`);
  
  const results = [];
  let totalOriginalSize = 0;
  let totalMinifiedSize = 0;
  
  for (const file of jsFiles) {
    const result = await minifyFile(file);
    if (result) {
      results.push(result);
      totalOriginalSize += result.originalSize;
      totalMinifiedSize += result.minifiedSize;
    }
  }
  
  const savings = totalOriginalSize - totalMinifiedSize;
  const savingsPercent = ((savings / totalOriginalSize) * 100).toFixed(1);
  
  console.log('\n✅ Minification complete!\n');
  console.log(`📊 Statistics:`);
  console.log(`   Files processed: ${results.length}`);
  console.log(`   Original size: ${(totalOriginalSize / 1024).toFixed(2)} KB`);
  console.log(`   Minified size: ${(totalMinifiedSize / 1024).toFixed(2)} KB`);
  console.log(`   Savings: ${(savings / 1024).toFixed(2)} KB (${savingsPercent}%)\n`);
}

// Run minification
minifyAll().catch((error) => {
  console.error('❌ Minification failed:', error);
  process.exit(1);
});


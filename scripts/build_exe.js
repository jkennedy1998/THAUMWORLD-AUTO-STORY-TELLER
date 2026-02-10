/**
 * Build executable from compiled TypeScript
 *
 * This script:
 * 1. Compiles TypeScript
 * 2. Packages the application into a standalone executable
 *
 * Usage: node scripts/build_exe.js
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🔨 Building THAUMWORLD executable...");
console.log("");

// Step 1: Compile TypeScript (optional - skip if dist exists)
const dist_dir = path.join(__dirname, "..", "dist");
if (fs.existsSync(dist_dir)) {
  console.log("📦 Step 1: Using existing compiled files...");
  console.log("   (dist/ folder already exists)");
} else {
  console.log("📦 Step 1: Compiling TypeScript...");
  console.log("   Note: Some TypeScript errors may appear but are safe to ignore");
  try {
    execSync("npm run build", { stdio: "inherit" });
    console.log("✅ TypeScript compilation complete");
  } catch (err) {
    console.warn("⚠️  TypeScript compilation had errors, but dist/ folder may still exist");
    console.warn("   Continuing with packaging...");
  }
}

console.log("");

// Step 2: Create output directory
console.log("📁 Step 2: Preparing output directory...");
const output_dir = path.join(__dirname, "..", "dist_exe");
if (!fs.existsSync(output_dir)) {
  fs.mkdirSync(output_dir, { recursive: true });
}
console.log(`   Output: ${output_dir}`);

// Step 3: Check if pkg is installed
console.log("");
console.log("🔍 Step 3: Checking for pkg...");
try {
  execSync("npx pkg --version", { stdio: "pipe" });
  console.log("✅ pkg is available");
} catch {
  console.log("📦 Installing pkg...");
  try {
    execSync("npm install --save-dev pkg", { stdio: "inherit" });
    console.log("✅ pkg installed");
  } catch (err) {
    console.error("❌ Failed to install pkg");
    process.exit(1);
  }
}

// Step 4: Create pkg configuration
console.log("");
console.log("📝 Step 4: Creating pkg configuration...");
const pkg_config = {
  pkg: {
    scripts: ["dist/**/*.js"],
    assets: [
      "local_data/**/*",
      "electron/**/*",
      "preload.js",
      "index.html",
      "package.json"
    ],
    targets: ["node18-win-x64", "node18-macos-x64", "node18-linux-x64"]
  }
};

const pkg_config_path = path.join(__dirname, "..", "package.json");
const original_pkg = JSON.parse(fs.readFileSync(pkg_config_path, "utf-8"));

// Merge pkg config
const updated_pkg = {
  ...original_pkg,
  bin: "dist/launcher/main.js",
  pkg: pkg_config.pkg
};

fs.writeFileSync(pkg_config_path, JSON.stringify(updated_pkg, null, 2));
console.log("✅ Updated package.json with pkg config");

// Step 5: Run pkg
console.log("");
console.log("🎁 Step 5: Packaging executable...");
console.log("   This may take a few minutes...");
console.log("");

try {
  execSync("npx pkg . --out-path dist_exe", { stdio: "inherit" });
  console.log("");
  console.log("✅ Packaging complete!");
} catch (err) {
  console.error("");
  console.error("❌ Packaging failed");
  // Restore original package.json
  fs.writeFileSync(pkg_config_path, JSON.stringify(original_pkg, null, 2));
  process.exit(1);
}

// Step 6: Restore original package.json
fs.writeFileSync(pkg_config_path, JSON.stringify(original_pkg, null, 2));

// Step 7: Show results
console.log("");
console.log("=".repeat(80));
console.log("✅ BUILD COMPLETE!");
console.log("=".repeat(80));
console.log("");

const exe_files = fs.readdirSync(output_dir)
  .filter(f => !f.endsWith(".js") && !f.endsWith(".map"));

if (exe_files.length > 0) {
  console.log("📦 Generated executables:");
  for (const file of exe_files) {
    const file_path = path.join(output_dir, file);
    const stats = fs.statSync(file_path);
    const size_mb = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`   ${file} (${size_mb} MB)`);
  }
} else {
  console.log("⚠️  No executables found in dist_exe/");
}

console.log("");
console.log("📁 Output directory: dist_exe/");
console.log("");
console.log("💡 To run the game:");
console.log("   dist_exe/thaumworld-auto-story-teller-win.exe");
console.log("");
console.log("📝 Note: Ollama must be running separately.");
console.log("   Download from: https://ollama.ai");
console.log("");

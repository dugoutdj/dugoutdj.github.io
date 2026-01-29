#!/bin/bash

# Deployment script for Dugout DJ
# This script builds and deploys the app to GitHub Pages

set -e

echo "🏗️  Building project..."
npm run build

echo "📦 Deploying to main branch..."

# Clone main branch to temp directory
TEMP_DIR="/tmp/dugoutdj-deploy-$(date +%s)"
git clone -b main https://github.com/dugoutdj/dugoutdj.github.io.git "$TEMP_DIR"

# Clear everything except .git and CNAME
cd "$TEMP_DIR"
find . -maxdepth 1 ! -name '.git' ! -name 'CNAME' ! -name '.' -exec rm -rf {} + 2>/dev/null || true

# Copy built files
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
cp -r "$SOURCE_DIR/dist/"* .

# Check if there are changes
if [ -n "$(git status --porcelain)" ]; then
    echo "📝 Committing changes..."
    git add -A
    git commit -m "Deploy: Update from source branch

Built on $(date +"%Y-%m-%d %H:%M:%S")

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

    echo "🚀 Pushing to GitHub..."
    git push origin main

    echo "✅ Deployment complete! Visit https://dugoutdj.com"
else
    echo "ℹ️  No changes to deploy"
fi

# Cleanup
cd -
rm -rf "$TEMP_DIR"

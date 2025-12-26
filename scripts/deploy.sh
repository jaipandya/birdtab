#!/bin/bash

# BirdTab Chrome Extension Deployment Script
# This script builds the extension and creates a deployment-ready zip file

set -e # Exit on any error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 BirdTab Deployment Script${NC}"
echo ""

# Read version from manifest.json
VERSION=$(node -p "require('./src/manifest.json').version")
echo -e "${BLUE}📦 Version: ${GREEN}${VERSION}${NC}"

# Get current git commit
COMMIT=$(git rev-parse --short HEAD)
echo -e "${BLUE}📝 Commit: ${GREEN}${COMMIT}${NC}"

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
  echo -e "${RED}⚠️  Warning: You have uncommitted changes!${NC}"
  read -p "Continue anyway? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Deployment cancelled${NC}"
    exit 1
  fi
fi

echo ""
echo -e "${BLUE}🔨 Building production...${NC}"

# Build for Chrome
npm run build:chrome

# Create releases directory if it doesn't exist
mkdir -p releases

# Create zip file
FILENAME="birdtab-v${VERSION}-${COMMIT}.zip"
FILEPATH="releases/${FILENAME}"

echo ""
echo -e "${BLUE}📦 Creating zip file...${NC}"

# Remove old zip if exists
rm -f "$FILEPATH"

# Create zip (excluding source maps which are already deleted)
cd dist-chrome
zip -r "../${FILEPATH}" . -x "*.map"
cd ..

# Get file size
SIZE=$(du -h "$FILEPATH" | cut -f1)

echo -e "${GREEN}✅ Build complete!${NC}"
echo ""
echo -e "${GREEN}📁 Package: ${FILEPATH}${NC}"
echo -e "${GREEN}📊 Size: ${SIZE}${NC}"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo -e "   1. Test the extension locally from dist-chrome/"
echo -e "   2. Upload ${FILENAME} to Chrome Web Store"
echo -e "   3. After deployment, tag this commit:"
echo -e "      ${BLUE}git tag -a deployed-v${VERSION} -m \"Deployed v${VERSION} to Chrome Web Store\"${NC}"
echo -e "      ${BLUE}git push origin deployed-v${VERSION}${NC}"
echo ""

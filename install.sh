#!/bin/bash

echo "Installing GIF Viewer..."
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install it first."
    exit 1
fi

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "npm is not installed. Please install it first."
    exit 1
fi

echo "Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "Failed to install dependencies."
    exit 1
fi

echo "Compiling TypeScript..."
npm run compile

if [ $? -ne 0 ]; then
    echo "Compilation failed."
    exit 1
fi

echo "Installing vsce (VS Code extension packager)..."
npm install -g @vscode/vsce

echo "Creating .vsix package..."
vsce package --allow-missing-repository

if [ $? -eq 0 ]; then
    echo ""
    echo "Done! The .vsix file has been created."
    echo ""
    echo "To install in VS Code:"
    echo "  1. Open VS Code"
    echo "  2. Press Ctrl+Shift+P"
    echo "  3. Run 'Extensions: Install from VSIX...'"
    echo "  4. Select the gif-viewer-1.0.0.vsix file"
    echo ""
    echo "Enjoy your GIFs!"
else
    echo ""
    echo "Something went wrong while creating the .vsix file."
    echo "You can try manually:"
    echo "  vsce package --allow-missing-repository"
fi

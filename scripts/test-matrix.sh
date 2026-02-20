#!/bin/bash

# test-matrix.sh - Local testing with different Node.js and RxJS versions
# Local equivalent of GitHub Actions matrix for development

# Do NOT use set -e - we check critical commands manually

# Colors for output (defined early to use in all sections)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect working mode (monorepo vs standalone)
IS_MONOREPO=false
if [ -f "../../package.json" ] && grep -q '"workspaces"' "../../package.json" 2>/dev/null; then
    IS_MONOREPO=true
    echo -e "${BLUE}🔧 Detected: Monorepo mode${NC}"
else
    echo -e "${BLUE}🔧 Detected: Standalone repository mode${NC}"
fi

# Cleanup function to restore package.json on interruption
cleanup() {
    if [ -f "package.json.backup" ]; then
        echo ""
        echo -e "${YELLOW}🔄 Cleaning up: restoring package.json...${NC}"
        mv package.json.backup package.json
        if [ "$IS_MONOREPO" = true ]; then
            yarn install --force 2>&1 | tail -3 || true
        else
            yarn install 2>&1 | tail -3 || true
        fi
    fi
}

# Trap for handling interrupts (Ctrl+C)
# Do NOT use EXIT - it triggers after every function!
trap cleanup INT TERM

# Load configuration from .test-matrix.json (single source of truth)
CONFIG_FILE=".test-matrix.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}❌ Configuration file ${CONFIG_FILE} not found!${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Loading test matrix from ${CONFIG_FILE}${NC}"

# Parse JSON using node (available wherever Node.js is)
NODE_VERSIONS=($(node -e "console.log(require('./${CONFIG_FILE}').node.versions.join(' '))"))
RXJS_VERSIONS=($(node -e "console.log(require('./${CONFIG_FILE}').rxjs.versions.map(v => v).join(' '))"))
CURRENT_NODE=$(node -e "console.log(require('./${CONFIG_FILE}').node.current)")

echo -e "${BLUE}  Node.js versions: ${NODE_VERSIONS[@]}${NC}"
echo -e "${BLUE}  RxJS versions: ${RXJS_VERSIONS[@]}${NC}"
echo ""

# Flags
QUICK_MODE=false
NODE_VERSION=""
RXJS_VERSION=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --node)
      NODE_VERSION="$2"
      shift 2
      ;;
    --rxjs)
      RXJS_VERSION="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --quick         Quick mode: current Node.js + all RxJS versions"
      echo "  --node VERSION  Test specific Node.js version (20, 22)"
      echo "  --rxjs VERSION  Test specific RxJS version (7.8.0, ^7.8.0)"
      echo "  --help          Show help"
      echo ""
      echo "Examples:"
      echo "  $0                          # Full matrix (6 combinations)"
      echo "  $0 --quick                  # Current Node + all RxJS"
      echo "  $0 --node 20 --rxjs 7.8.0   # Specific combination"
      echo "  $0 --rxjs ^7.8.0            # All Node.js + latest RxJS"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Check nvm (it's a shell function, not a command)
# First try to load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Check nvm availability as a function
if ! type nvm &> /dev/null; then
    CURRENT_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
    echo ""
    echo -e "${YELLOW}╔════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  ⚠️  nvm is not installed                  ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Without nvm, cannot test different Node.js versions${NC}"
    echo -e "${YELLOW}Will use only current version: ${CURRENT_NODE}${NC}"
    echo ""
    echo -e "${BLUE}To test all Node.js versions (${NODE_VERSIONS[@]}):${NC}"
    echo -e "${BLUE}1. Install nvm: https://github.com/nvm-sh/nvm${NC}"
    echo -e "${BLUE}2. Install versions: nvm install 20 && nvm install 22${NC}"
    echo -e "${BLUE}3. Run again: yarn test:matrix${NC}"
    echo ""
    
    if [ "$QUICK_MODE" = false ] && [ -z "$NODE_VERSION" ]; then
        echo -e "${YELLOW}💡 Tip: Use 'yarn test:matrix:quick' for fast check${NC}"
        echo ""
    fi
    
    NODE_VERSIONS=("$CURRENT_NODE")
fi

# Save current RxJS version
ORIGINAL_RXJS=$(grep '"rxjs":' package.json | head -1 | sed 's/.*"rxjs": "\(.*\)".*/\1/')
echo -e "${BLUE}📦 Current RxJS version: ${ORIGINAL_RXJS}${NC}"

# Function to run tests
run_tests() {
    local node_ver=$1
    local rxjs_ver=$2
    
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}🧪 Testing: Node.js ${node_ver} + RxJS ${rxjs_ver}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Switch Node.js (if nvm is available)
    if type nvm &> /dev/null; then
        echo -e "${YELLOW}🔄 Switching to Node.js ${node_ver}...${NC}"
        
        # Check if version is installed
        if ! nvm ls $node_ver &> /dev/null || ! nvm ls $node_ver | grep -q "v${node_ver}"; then
            echo -e "${YELLOW}⚠️  Node.js ${node_ver} not installed, installing...${NC}"
            nvm install $node_ver
        fi
        
        # Switch to version
        nvm use $node_ver > /dev/null
        
        # Get full version (e.g. v20.19.6)
        local full_version=$(nvm current)
        
        # Update PATH - put nvm version at THE START
        export PATH="$NVM_DIR/versions/node/$full_version/bin:$PATH"
        
        # Also update variables for yarn
        export NODE="$NVM_DIR/versions/node/$full_version/bin/node"
        export npm_config_prefix="$NVM_DIR/versions/node/$full_version"
        
        # Verify switch was successful
        local actual_version=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$actual_version" != "$node_ver" ]; then
            echo -e "${RED}❌ Failed to switch to Node.js ${node_ver} (got ${actual_version})${NC}"
            echo -e "${YELLOW}   PATH: $PATH${NC}"
            echo -e "${YELLOW}   which node: $(which node)${NC}"
            return 1
        fi
    fi
    
    echo -e "${YELLOW}📌 Node.js version: $(node -v)${NC}"
    echo -e "${YELLOW}   Path: $(which node)${NC}"
    
    # Install specific RxJS version
    echo -e "${YELLOW}🔄 Installing RxJS ${rxjs_ver}...${NC}"
    
    # Save backup only on first run (for both modes)
    if [ ! -f "package.json.backup" ]; then
        cp package.json package.json.backup
    fi
    
    if [ "$IS_MONOREPO" = true ]; then
        # Monorepo mode: change package.json and reinstall
        
        # Restore original package.json before changing
        if [ -f "package.json.backup" ]; then
            cp package.json.backup package.json
        fi
        
        # Change RxJS version in package.json
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/\"rxjs\": \"[^\"]*\"/\"rxjs\": \"${rxjs_ver}\"/" package.json
        else
            # Linux
            sed -i "s/\"rxjs\": \"[^\"]*\"/\"rxjs\": \"${rxjs_ver}\"/" package.json
        fi
        
        # Install dependencies (ignore warnings)
        yarn install --force 2>&1 | tail -5 || true
    else
        # Standalone mode: regular yarn add (ignore warnings)
        # Note: yarn add modifies package.json, backup is created above
        yarn add rxjs@${rxjs_ver} 2>&1 | tail -5 || true
    fi
    
    # Detect installed RxJS version
    local installed_rxjs="unknown"
    
    # Try several paths to RxJS
    if [ -f "node_modules/rxjs/package.json" ]; then
        installed_rxjs=$(node -e "console.log(require('./node_modules/rxjs/package.json').version)" 2>/dev/null || echo "unknown")
    fi
    
    # If not found in local node_modules, check monorepo root
    if [ "$installed_rxjs" = "unknown" ] && [ -f "../../node_modules/rxjs/package.json" ]; then
        installed_rxjs=$(node -e "console.log(require('../../node_modules/rxjs/package.json').version)" 2>/dev/null || echo "unknown")
    fi
    
    # If still unknown, try via yarn list
    if [ "$installed_rxjs" = "unknown" ]; then
        installed_rxjs=$(yarn list --pattern rxjs --depth=0 2>/dev/null | grep "rxjs@" | sed 's/.*rxjs@//' | sed 's/ .*//' | head -1)
    fi
    
    echo -e "${YELLOW}📌 Installed RxJS: ${installed_rxjs}${NC}"
    
    # Only warning if can't detect, but continue
    if [ "$installed_rxjs" = "unknown" ] || [ -z "$installed_rxjs" ]; then
        echo -e "${YELLOW}⚠️  Could not detect RxJS version, but continuing anyway...${NC}"
    fi
    
    # Run Jest tests
    echo -e "${YELLOW}🧪 Running Jest tests...${NC}"
    yarn test > /tmp/test-output.log 2>&1
    local jest_exit=$?
    if [ $jest_exit -eq 0 ]; then
        echo -e "${GREEN}✅ Jest tests passed${NC}"
    else
        echo -e "${RED}❌ Jest tests failed (exit code: $jest_exit)${NC}"
        tail -20 /tmp/test-output.log
        return 1
    fi
    
    # Run Karma tests
    echo -e "${YELLOW}🧪 Running Karma tests...${NC}"
    yarn test:karma:single > /tmp/karma-output.log 2>&1
    local karma_exit=$?
    if [ $karma_exit -eq 0 ]; then
        echo -e "${GREEN}✅ Karma tests passed${NC}"
    else
        echo -e "${RED}❌ Karma tests failed (exit code: $karma_exit)${NC}"
        tail -20 /tmp/karma-output.log
        return 1
    fi
    
    echo -e "${GREEN}✅ All tests passed for Node ${node_ver} + RxJS ${rxjs_ver}${NC}"
    return 0
}

# Determine list of combinations to test
COMBINATIONS=()

if [ -n "$NODE_VERSION" ] && [ -n "$RXJS_VERSION" ]; then
    # Specific combination
    COMBINATIONS+=("$NODE_VERSION:$RXJS_VERSION")
elif [ -n "$NODE_VERSION" ]; then
    # Specific Node + all RxJS
    for rxjs in "${RXJS_VERSIONS[@]}"; do
        COMBINATIONS+=("$NODE_VERSION:$rxjs")
    done
elif [ -n "$RXJS_VERSION" ]; then
    # All Node + specific RxJS
    for node in "${NODE_VERSIONS[@]}"; do
        COMBINATIONS+=("$node:$RXJS_VERSION")
    done
elif [ "$QUICK_MODE" = true ]; then
    # Quick mode: current Node + all RxJS
    CURRENT_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
    for rxjs in "${RXJS_VERSIONS[@]}"; do
        COMBINATIONS+=("$CURRENT_NODE:$rxjs")
    done
else
    # Full matrix
    for node in "${NODE_VERSIONS[@]}"; do
        for rxjs in "${RXJS_VERSIONS[@]}"; do
            COMBINATIONS+=("$node:$rxjs")
        done
    done
fi

# Report
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   DexRx Local Test Matrix Runner          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📋 Will test ${#COMBINATIONS[@]} combinations:${NC}"
for combo in "${COMBINATIONS[@]}"; do
    IFS=':' read -r node_v rxjs_v <<< "$combo"
    echo -e "  • Node.js ${node_v} + RxJS ${rxjs_v}"
done
echo ""

# Counters
PASSED=0
FAILED=0
FAILED_COMBOS=()

# Run tests for each combination
for combo in "${COMBINATIONS[@]}"; do
    IFS=':' read -r node_v rxjs_v <<< "$combo"
    
    if run_tests "$node_v" "$rxjs_v"; then
        ((PASSED++))
    else
        ((FAILED++))
        FAILED_COMBOS+=("Node ${node_v} + RxJS ${rxjs_v}")
    fi
done

# Restore original state
echo ""
if [ -f "package.json.backup" ]; then
    echo -e "${YELLOW}🔄 Restoring original package.json...${NC}"
    mv package.json.backup package.json
    
    if [ "$IS_MONOREPO" = true ]; then
        # Monorepo: full reinstall
        yarn install --force 2>&1 | tail -5 || true
    else
        # Standalone: regular install
        yarn install 2>&1 | tail -5 || true
    fi
fi

# Final report
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Test Matrix Summary              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Total combinations tested: ${#COMBINATIONS[@]}"
echo -e "${GREEN}✅ Passed: ${PASSED}${NC}"
echo -e "${RED}❌ Failed: ${FAILED}${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Failed combinations:${NC}"
    for failed in "${FAILED_COMBOS[@]}"; do
        echo -e "  ${RED}• ${failed}${NC}"
    done
    echo ""
    exit 1
else
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    echo ""
    exit 0
fi

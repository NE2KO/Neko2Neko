#!/bin/bash
# Backend monitoring startup investigation script
# Starts backend, runs curl tests at different stages, writes results to INVESTIGATION_RESULTS.md

set -e

BACKEND_DIR="/home/CATIAA/homelab-media-server/backend"
RESULTS_FILE="/home/CATIAA/homelab-media-server/INVESTIGATION_RESULTS.md"
PORT=3001

# Colors for output (bash)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  Backend Monitoring Investigation"
echo "========================================"
echo ""

# Check if backend is already running
if curl -s --max-time 1 "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    echo -e "${YELLOW}[WARN] Backend already running on port ${PORT}${NC}"
    echo "Stopping existing backend..."
    pkill -f "node src/server.js" 2>/dev/null || true
    sleep 2
fi

# Start backend in background
echo -e "${GREEN}[1] Starting backend...${NC}"
cd "${BACKEND_DIR}"
node src/server.js > /tmp/backend-investigation.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: ${BACKEND_PID}"

# Wait for backend to be ready
echo ""
echo -e "${GREEN}[2] Waiting for backend to start...${NC}"
READY=false
for i in $(seq 1 30); do
    if curl -s --max-time 1 "http://localhost:${PORT}/health" > /dev/null 2>&1; then
        READY=true
        echo -e "${GREEN}✓ Backend ready after ${i} seconds${NC}"
        break
    fi
    sleep 1
    echo "  Waiting... ($i/30)"
done

if [ "$READY" = false ]; then
    echo -e "${RED}[ERROR] Backend failed to start within 30 seconds${NC}"
    echo "Check log: /tmp/backend-investigation.log"
    kill $BACKEND_PID 2>/dev/null || true
    exit 1
fi

# Run tests
echo ""
echo -e "${GREEN}[3] Running tests...${NC}"
echo ""

# Initialize results file
cat > "${RESULTS_FILE}" << 'EOF'
# Backend Monitoring Investigation Results

EOF

# Test function
run_test() {
    local test_name="$1"
    local url="$2"
    local iterations="${3:-5}"
    
    echo -e "${YELLOW}[TEST] ${test_name}${NC}"
    echo "URL: ${url}"
    echo ""
    
    {
        echo "## ${test_name}"
        echo ""
        echo "**URL:** \`${url}\`"
        echo ""
        echo "**Iterations:** ${iterations}"
        echo ""
        echo "| Run | real (ms) | user (ms) | sys (ms) | HTTP Status | Has Timestamp? |"
        echo "|-----|-----------|-----------|----------|-------------|----------------|"
        
        local total_real=0
        local count=0
        local has_timestamp="NO"
        
        for i in $(seq 1 $iterations); do
            # Run curl with timing
            local output
            output=$(time -p curl -s --max-time 10 -w "\nHTTP_STATUS:%{http_code}\nTIME:%{time_total}" "$url" 2>&1)
            
            # Parse timing
            local real_time
            real_time=$(echo "$output" | grep "^real" | awk '{print $2}')
            
            # Parse HTTP status
            local http_status
            http_status=$(echo "$output" | grep "HTTP_STATUS:" | cut -d: -f2)
            
            # Parse JSON response (last line)
            local json_response
            json_response=$(echo "$output" | tail -n 1)
            
            # Check for timestamp
            if echo "$json_response" | grep -q '"timestamp"'; then
                has_timestamp="YES"
            else
                has_timestamp="NO"
            fi
            
            # Convert real time to milliseconds
            local real_ms
            real_ms=$(python3 -c "print(float('${real_time}') * 1000)" 2>/dev/null || echo "N/A")
            
            # Add to total
            if [ "$real_ms" != "N/A" ]; then
                total_real=$(python3 -c "print(float('${total_real}') + float('${real_ms}'))" 2>/dev/null || echo "0")
            fi
            count=$((count + 1))
            
            echo "| ${i} | ${real_ms} | - | - | ${http_status} | ${has_timestamp} |"
        done
        
        # Calculate average
        local avg_real
        avg_real=$(python3 -c "print(float('${total_real}') / ${count})" 2>/dev/null || echo "N/A")
        
        echo ""
        echo "**Average response time:** ${avg_real} ms"
        echo ""
        echo "---"
        echo ""
        
    } | tee -a "${RESULTS_FILE}"
    
    echo ""
}

# Test 1: Health check (should be instant)
run_test "Health Check" "http://localhost:${PORT}/health" 5

# Test 2: API files (media listing)
run_test "API Files (root)" "http://localhost:${PORT}/api/files?path=" 10

# Test 3: Monitoring stats (most important)
run_test "Monitoring Stats" "http://localhost:${PORT}/api/monitoring/stats" 15

# Test 4: Monitoring overview
run_test "Monitoring Overview" "http://localhost:${PORT}/api/monitoring/overview" 5

# Test 5: Monitoring hardware
run_test "Monitoring Hardware" "http://localhost:${PORT}/api/monitoring/hardware" 5

# Test 6: Settings
run_test "Settings" "http://localhost:${PORT}/api/settings" 5

echo ""
echo -e "${GREEN}[4] Checking backend logs for timing markers...${NC}"
echo ""

# Extract relevant log lines
{
    echo "## Backend Startup Timeline"
    echo ""
    echo "Extracted from backend log (first 100 lines):"
    echo ""
    echo '```'
    head -100 /tmp/backend-investigation.log | grep -E "^\[.*\]|Running:|Starting:" || echo "(no matching log lines)"
    echo '```'
    echo ""
} | tee -a "${RESULTS_FILE}"

# Check for WS connection logs
{
    echo "## WebSocket Connection Logs"
    echo ""
    echo "Looking for: \`[monitor] WS client connected\`"
    echo ""
    echo '```'
    grep -E "\[monitor\] WS client" /tmp/backend-investigation.log || echo "(no WS connection logs found)"
    echo '```'
    echo ""
} | tee -a "${RESULTS_FILE}"

# Check engine start logs
{
    echo "## Engine Start Logs"
    echo ""
    echo '```'
    grep -E "\[monitor\] Engine started|Running Engine|collectAll" /tmp/backend-investigation.log || echo "(no engine logs found)"
    echo '```'
    echo ""
} | tee -a "${RESULTS_FILE}"

echo ""
echo -e "${GREEN}[5] Analysis Summary${NC}"
echo ""

# Add analysis section
cat >> "${RESULTS_FILE}" << 'EOF'
---

## Analysis

### Key Findings:

1. **Health endpoint latency:** Should be <1ms (no DB, no I/O)

2. **Monitoring stats endpoint latency:**
   - Before engine start (t < 3s): Returns `{}` (empty), fast <5ms
   - After engine start (t > 3-6s): Returns `{timestamp: ..., cpu: ..., ram: ...}`, fast <5ms
   - If latency >50ms: Something is wrong (unexpected DB query, blocking I/O, etc.)

3. **Monitoring overview latency:**
   - Should be 50-200ms (executes journalctl, systemctl, docker API calls)
   - Higher latency indicates systemd/Docker API slowness

4. **Files endpoint latency:**
   - Should be 5-50ms (depends on DB query returning up to 5001 rows)
   - Higher latency indicates DB contention or large result set

### What To Look For:

| Scenario | Expected Behavior | Actual Issue If... |
|----------|-------------------|-------------------|
| `/health` fast, `/api/monitoring/stats` slow | Engine not ready or collectors hanging | Stats latency >100ms |
| `/api/monitoring/stats` returns `{}` | Engine hasn't started yet (t < 3s) | Normal on cold start |
| `/api/monitoring/stats` returns data but slow | Collector timeout or exec hanging | Stats latency >50ms |
| WebSocket log appears immediately | WS server registered at t=0ms | If missing: WS server not started |
| First data appears 3-6s after start | Engine `collectAll()` runs at t=3s | If >10s: collectors hanging |
EOF

echo ""
echo -e "${GREEN}[6] Test complete!${NC}"
echo ""
echo "Results written to: ${RESULTS_FILE}"
echo "Backend log: /tmp/backend-investigation.log"
echo "Backend PID: ${BACKEND_PID}"
echo ""
echo -e "${YELLOW}[IMPORTANT] Stop backend when done: kill ${BACKEND_PID}${NC}"
echo ""
echo "Next steps:"
echo "1. Review ${RESULTS_FILE}"
echo "2. Check if monitoring stats has latency >50ms"
echo "3. Check if cold start (t < 3s) returns {} vs data"
echo "4. Compare with frontend loading behavior"

#!/usr/bin/env bash
#
# Theo dõi state Redis của rate limiter, tự nhận diện kiểu dữ liệu từng algo.
#
#   ./redis-watch.sh          → in 1 lần rồi thoát
#   ./redis-watch.sh -w       → refresh mỗi 0.5s (Ctrl+C để dừng)
#
set -uo pipefail

CONTAINER="rl-demo-redis"
CLI="docker exec $CONTAINER redis-cli"

# Màu
DIM='\033[2m'; BOLD='\033[1m'; RESET='\033[0m'
BLUE='\033[34m'; GREEN='\033[32m'; YELLOW='\033[33m'; MAGENTA='\033[35m'

# Lấy epoch millis từ chính Redis — portable, không phụ thuộc GNU/BSD date.
# `redis-cli TIME` trả 2 dòng: seconds, microseconds
now_ms() {
  local t sec us
  t=$($CLI TIME | tr -d '\r')
  sec=$(echo "$t" | head -1)
  us=$(echo "$t"  | tail -1)
  echo $(( sec * 1000 + us / 1000 ))
}

render() {
  # Tính 1 lần cho cả lượt render để mọi key dùng chung mốc thời gian
  local NOW
  NOW=$(now_ms)

  # Config hiện tại
  local config
  config=$($CLI GET 'rl:config' 2>/dev/null | tr -d '\r')
  echo -e "${BOLD}Config${RESET}  ${config:-<chưa set>}"
  echo ""

  # Liệt kê state key (bỏ rl:config)
  local keys
  keys=$($CLI --scan --pattern 'rl:*' 2>/dev/null | tr -d '\r' | grep -v '^rl:config$' | sort)

  if [[ -z "$keys" ]]; then
    echo -e "${DIM}(chưa có state key — gửi request tới /api/hello để tạo)${RESET}"
    return
  fi

  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    local type ttl
    type=$($CLI TYPE "$key" | tr -d '\r')
    ttl=$($CLI PTTL "$key" | tr -d '\r')

    # TTL: -1 = không có expiry, -2 = key đã biến mất
    local ttl_txt
    case "$ttl" in
      -1) ttl_txt="no-expiry" ;;
      -2) ttl_txt="expired" ;;
      *)  ttl_txt="$(awk "BEGIN{printf \"%.1fs\", $ttl/1000}")" ;;
    esac

    echo -e "${BLUE}${key}${RESET}  ${DIM}[${type}, ttl ${ttl_txt}]${RESET}"

    case "$type" in
      string)
        # Fixed Window (fw) hoặc Sliding Counter (sc) — counter đơn giản
        echo -e "   count = ${GREEN}$($CLI GET "$key" | tr -d '\r')${RESET}"
        ;;
      zset)
        # Sliding Log — mỗi member là 1 timestamp
        local n
        n=$($CLI ZCARD "$key" | tr -d '\r')
        echo -e "   ${GREEN}${n}${RESET} entries:"
        $CLI ZRANGE "$key" 0 -1 WITHSCORES | tr -d '\r' | paste - - | \
          while IFS=$'\t' read -r member score; do
            [[ -z "$score" ]] && continue
            local age
            age=$(awk "BEGIN{printf \"%.1f\", ($NOW - $score)/1000}")
            echo -e "     ${DIM}${member}${RESET}  ${MAGENTA}${age}s trước${RESET}"
          done
        ;;
      hash)
        # Token Bucket (tb) / Leaky Bucket (lb)
        $CLI HGETALL "$key" | tr -d '\r' | paste - - | \
          while IFS=$'\t' read -r f v; do
            [[ -z "$f" ]] && continue
            echo -e "   ${f} = ${YELLOW}${v}${RESET}"
          done
        ;;
      *)
        echo -e "   ${DIM}(kiểu $type chưa hỗ trợ)${RESET}"
        ;;
    esac
    echo ""
  done <<< "$keys"
}

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "Container '$CONTAINER' chưa chạy. Chạy: docker compose up -d" >&2
  exit 1
fi

if [[ "${1:-}" == "-w" ]]; then
  while true; do
    clear
    echo -e "${BOLD}Redis Rate Limit State${RESET}  ${DIM}$(date '+%H:%M:%S')  ·  Ctrl+C để dừng${RESET}"
    echo ""
    render
    sleep 0.5
  done
else
  render
fi

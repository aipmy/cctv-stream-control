#!/bin/bash
STORAGE_DIR=${1:-/Volumes/RMFS/cctv_record}
HLS_DIR="$STORAGE_DIR/record_hls"
MP4_DIR="$STORAGE_DIR/record_mp4"

if [ ! -d "$HLS_DIR" ]; then
  exit 0
fi

cd "$HLS_DIR" || exit 0

for cam in */; do
  [ -e "$cam" ] || continue
  cam=${cam%/}
  
  # Find ts files older than 1 minute
  find "$cam" -maxdepth 1 -name "seg_*.ts" -mmin +1 -print0 2>/dev/null | while IFS= read -r -d '' file; do
    # Extract unix timestamp from filename seg_1234567890.ts
    filename=$(basename "$file")
    ts=$(echo "$filename" | sed -E 's/seg_([0-9]+)\.ts/\1/')
    
    if [[ ! "$ts" =~ ^[0-9]+$ ]]; then
      continue
    fi
    
    # Format date paths
    # Note: date -r <ts> works on macOS/BSD. On Linux it's date -d @<ts>
    if date --version >/dev/null 2>&1; then
      # GNU date
      date_path=$(date -d "@$ts" "+%Y/%m/%d/%H")
      min=$(date -d "@$ts" "+%M")
    else
      # BSD date (macOS)
      date_path=$(date -r "$ts" "+%Y/%m/%d/%H")
      min=$(date -r "$ts" "+%M")
    fi
    
    TARGET_DIR="$MP4_DIR/$cam/$date_path"
    TARGET_FILE="$TARGET_DIR/$min.ts"
    
    mkdir -p "$TARGET_DIR"
    mv "$file" "$TARGET_FILE"
    
    # Preserve timestamp
    if touch --version >/dev/null 2>&1; then
      touch -d "@$ts" "$TARGET_FILE"
    else
      # BSD touch
      # Format: [[CC]YY]MMDDhhmm[.SS]
      touch_time=$(date -r "$ts" "+%Y%m%d%H%M.%S")
      touch -t "$touch_time" "$TARGET_FILE"
    fi
  done
done

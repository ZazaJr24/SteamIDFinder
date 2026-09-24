#!/bin/sh
# Mac/Linux: serves the game folder and opens it (needs Python 3).
cd "$(dirname "$0")/game" || exit 1
URL="http://localhost:8080/"
( sleep 1; (command -v open >/dev/null && open "$URL") || xdg-open "$URL" ) >/dev/null 2>&1 &
echo "CubeCraft Legends: $URL  (Ctrl+C to stop)"
python3 -m http.server 8080

#!/bin/zsh
cd "$(dirname "$0")"
clear

URL="http://127.0.0.1:4173"

echo "Dialogue API publishing test"
echo ""
echo "Keep the normal Start Dialogue.command window open while running this test."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not available."
  read "?Press Return to close."
  exit 1
fi

ZIP_PATH=$(osascript -e 'POSIX path of (choose file with prompt "Choose the prototype ZIP to publish through Dialogue API")' 2>/dev/null)
if [[ $? -ne 0 || -z "$ZIP_PATH" ]]; then
  exit 0
fi

node scripts/publish-revision.js "$ZIP_PATH" --base "$URL" --project landline --name Landline
STATUS=$?

echo ""
if [[ $STATUS -eq 0 ]]; then
  echo "Opening the Landline project so you can see the new revision."
  open "$URL/project-landline.html"
else
  echo "The API publishing test did not complete."
fi

echo ""
read "?Press Return to close this test window."
exit $STATUS

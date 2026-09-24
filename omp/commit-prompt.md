Commit every current change in this workspace with one short commit message
that tells a designer what changed, then push this branch to origin
(git push -u origin HEAD). If the push is rejected because the remote has
new commits, run git pull --rebase and push again; if the rebase conflicts,
run git rebase --abort and stop. Do not ask questions and do not change any
files. Reply with a single sentence: what was committed and whether the
push succeeded; if the push was rejected, quote the reason.

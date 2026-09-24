Save this branch's work to origin. If there are uncommitted changes, commit
them all with one short message that tells a designer what changed. If
there is nothing to commit, that is normal: commits made earlier (for
example Dialogue's own preview setup) may simply not be pushed yet, so just
push them. Then push the branch (git push -u origin HEAD). If the push is
rejected because the remote has new commits, run git pull --rebase and push
again; if the rebase conflicts, run git rebase --abort and stop. Do not ask
questions and do not change any files. Reply with a single plain sentence
for a designer: what was saved (the new commit, or which earlier commits
were pushed) and whether the push succeeded; if it was rejected, quote the
reason.

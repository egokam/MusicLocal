#execution: ./github.sh "your commit message"

#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE="origin"
SOURCE_BRANCH="main"
TARGET_BRANCH="App_Store"

fail() {
  printf 'github.sh: %s\n' "$1" >&2
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || fail "Run this script from inside the Git repository."
cd "$REPO_ROOT"

CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "$SOURCE_BRANCH" ]] || fail "Switch to $SOURCE_BRANCH, make your shared changes, then run ./github.sh."

if [[ $# -gt 1 ]]; then
  fail 'Usage: ./github.sh ["commit message"]'
fi

COMMIT_MESSAGE="${1:-}"
if [[ -z "$COMMIT_MESSAGE" ]]; then
  read -r -p 'Commit message: ' COMMIT_MESSAGE || fail 'No commit message was provided.'
fi
[[ -n "${COMMIT_MESSAGE//[[:space:]]/}" ]] || fail 'The commit message cannot be empty.'

for operation in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
  OPERATION_PATH="$(git rev-parse --git-path "$operation")"
  [[ ! -e "$OPERATION_PATH" ]] || fail "A Git $operation operation is already in progress. Finish or abort it first."
done

git fetch "$REMOTE" --prune

for branch in "$SOURCE_BRANCH" "$TARGET_BRANCH"; do
  git show-ref --verify --quiet "refs/heads/$branch" || fail "Local branch $branch does not exist."
  git show-ref --verify --quiet "refs/remotes/$REMOTE/$branch" || fail "Remote branch $REMOTE/$branch does not exist."

  LOCAL_HEAD="$(git rev-parse "refs/heads/$branch")"
  REMOTE_HEAD="$(git rev-parse "refs/remotes/$REMOTE/$branch")"
  [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]] || fail "$branch is not synchronized with $REMOTE/$branch. Synchronize it before running this script."
done

[[ -n "$(git status --porcelain)" ]] || fail 'There are no changes to commit.'
[[ -z "$(git diff --name-only --diff-filter=U)" ]] || fail 'Resolve the existing merge conflicts first.'

printf '\nCurrent changes on %s:\n' "$SOURCE_BRANCH"
git status --short
git diff --stat
git diff --cached --stat
printf '\nThis will stage all changes above, including deletions and untracked files, commit them on %s, cherry-pick that commit onto %s, and push both branches.\n' "$SOURCE_BRANCH" "$TARGET_BRANCH"
read -r -p 'Continue? [y/N] ' CONFIRMATION || true
case "${CONFIRMATION,,}" in
  y|yes) ;;
  *) printf 'Cancelled; no files were staged or committed.\n'; exit 0 ;;
esac

git add --all
git diff --cached --check || fail 'The staged changes contain whitespace errors; review them before committing.'
git diff --cached --quiet && fail 'There are no staged changes to commit.'

git commit -m "$COMMIT_MESSAGE"
SHARED_COMMIT="$(git rev-parse HEAD)"
git push "$REMOTE" "$SOURCE_BRANCH"

git switch "$TARGET_BRANCH"
if ! git cherry-pick -x "$SHARED_COMMIT"; then
  printf '\nThe commit was pushed to %s, but could not be applied automatically to %s. Resolve the conflicts, run `git cherry-pick --continue`, then push %s.\n' \
    "$SOURCE_BRANCH" "$TARGET_BRANCH" "$TARGET_BRANCH" >&2
  exit 1
fi

git push -u "$REMOTE" "$TARGET_BRANCH"
git switch "$SOURCE_BRANCH"

printf '\nDone. Commit %s is on both branches and pushed to %s.\n' "${SHARED_COMMIT:0:7}" "$REMOTE"

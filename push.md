# Commit and push rules

## Branch contents

- `main` is the full app and includes the Downloader feature.
- `App_Store` receives shared app changes but must not expose the Downloader tab. Keep the Downloader category and its navigation route out of the App Store build.
- Do not assume Downloader is excluded automatically. The repository script cherry-picks the entire commit.

## Shared changes for both branches

From a clean, synchronized `main` branch, review `git status` and the full diff first. If every change is intended for both branches, run:

```bash
./github.sh "<commit message>"
```

The script stages all tracked and untracked changes, commits on `main`, pushes `main`, cherry-picks that whole commit onto `App_Store`, pushes `App_Store`, and returns to `main`. Review untracked files and deletions before confirming. Do not use this script when the changes include Downloader-specific work.

## Changes that include Downloader work

Keep Downloader changes on `main`; send only shared changes to `App_Store`.

1. On `main`, selectively stage and commit the shared changes or shared hunks first. Use interactive staging for files that contain both shared and Downloader edits.
2. Push that shared commit to `origin/main`.
3. Switch to `App_Store`, cherry-pick only the shared commit with `git cherry-pick -x <shared-commit>`, inspect the branch to confirm the Downloader category and route remain absent, then push `origin/App_Store`.
4. Return to `main`, commit the remaining Downloader-specific changes, and push that commit only to `origin/main`.

Never cherry-pick a commit containing Downloader changes onto `App_Store`. If a shared change requires touching a file that also contains Downloader navigation, preserve the shared edits while keeping the Downloader category and route excluded.

## Before finishing

- Confirm both intended pushes succeeded and `git status --short --branch` is clean.
- Leave the checkout on `main`.
- Do not start an IPA build unless the user also asks for one.

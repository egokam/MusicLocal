# Cloud Music Storage Goal

Add an optional cloud storage service so users can keep their music library backed up to an account and access it again after signing in.

## Monthly plans

| Storage | Price |
| --- | ---: |
| 1 GB | $1/month |
| 3 GB | $2/month |
| 5 GB | $4/month |

## User experience

- Users can create an account or sign in to an existing account.
- A user's cloud music and subscription are associated with that account, so they remain available when the user signs in again.
- Users can choose, upgrade, or cancel a monthly storage plan.
- The app shows the current plan, storage used, and remaining storage.
- Uploads stop when the plan's storage limit is reached; users can remove cloud files or choose a larger plan to make room.

## Cloud work required

- Account authentication and secure session handling.
- Cloud file storage for music and the library data needed to restore it.
- Per-account storage quotas and usage tracking.
- Subscription purchase, renewal, cancellation, and entitlement checks.
- Secure authorization so each account can access only its own stored files.

The cloud provider, authentication method, payment flow, and supported file types still need to be chosen before implementation.

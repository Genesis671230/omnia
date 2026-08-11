# Couriers & routing

## Rules
| Order type    | Courier         | Cutoff  | Person   | Notes |
|---------------|-----------------|---------|----------|-------|
| Local         | OnTrack         | 8:30pm  | Sinan    | Local UAE deliveries |
| International | SMSA or DHL     | 1:00pm  | Yaseen   | After 1pm → next-day pickup |
| Same-day urgent | (manual)      | —       | Muneeb   | Urgent same-day only |

Picking/packing for both: **Mark**.

## Cutoff logic
- International order confirmed **before 1:00pm** → today's SMSA/DHL batch.
- International order confirmed **after 1:00pm** → HELD, tomorrow's pickup.
  Post `⏭️ Held for tomorrow` so nobody expects same-day.
- Local order confirmed **before 8:30pm** → today's OnTrack batch.
- Local after 8:30pm → tomorrow's OnTrack.

## Dispatch batches to post
- `🚚 SMSA/DHL batch — N orders — cutoff 1pm — @Yaseen`
- `🚚 OnTrack batch — N orders — cutoff 8:30pm — @Sinan`
- `⚡ Same-day urgent — @Muneeb`
- `📦 Ready to pick — @Mark`

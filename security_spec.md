# Security Specification & Payload-First TDD

## 1. Data Invariants
1. Every `/users/{userId}` document can only be read or written by the authenticated, email-verified user whose `request.auth.uid == userId`.
2. Every `/users/{userId}/floorplans/{planId}` document belongs strictly to `userId`, and `ownerId` must equal `request.auth.uid` on create and remain immutable on update.
3. Path variables (`userId`, `planId`) must pass `isValidId()` (`^[a-zA-Z0-9_-]+$`, `<= 128` chars) on single-document operations (`get`, `create`, `update`, `delete`).
4. `createdAt` must equal `request.time` on `create` and remain immutable on `update`; `updatedAt` must equal `request.time` on both `create` and `update`.
5. No ghost/shadow fields are allowed (`keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update).
6. List bounds (`edges.size() >= 1 && edges.size() <= 60`, `elements.size() <= 120`, `sharedWithEmails.size() >= 1 && sharedWithEmails.size() <= 20`) and string lengths (`projectName <= 100`, `analysisNotes <= 1000`) are strictly enforced to prevent resource exhaustion.
7. Every `/shared_floorplans/{shareId}` document can only be created or deleted by its verified `ownerId == request.auth.uid`, must reference an existing `/users/{ownerId}/floorplans/{sourcePlanId}` owned by the creator on create, and can only be read (`get`/`list`) by the owner or a verified user whose lowercase token email appears in `sharedWithEmails`.
8. Tiered updates on `/shared_floorplans/{shareId}`: Tier 1 (`existing().ownerId == request.auth.uid`) may update `sharedWithEmails`, `accessLevel` (`'editor' | 'viewer'`), `ownerDisplayName`, and floorplan body fields; Tier 2 (verified recipient whose lowercase email is in `sharedWithEmails` when `accessLevel` is `'editor'` or omitted) may update ONLY the floorplan body fields plus `lastEditedByEmail` (strictly equal to `request.auth.token.email.lower()`) and `lastEditedByName` — never `ownerId`, `sourcePlanId`, `sharedWithEmails`, `accessLevel`, or `createdAt`.
9. Every `/users/{userId}/custom_cabinets/{cabinetId}` document belongs strictly to `userId`, requires `isOwner(userId)` (`email_verified == true`), validates `id == cabinetId` and `ownerId == request.auth.uid` (immutable on update), enforces strict map keys and numeric bounds on `cabinetSpec` (`drawerCount` 0..6, `doorMode` in `['none','single-left','single-right','double']`, `shelfCount` 0..8, `hasHangingRod` bool, `hasSink` bool) and dimensions, and binds `createdAt == request.time` (immutable) and `updatedAt == request.time`.

## 2. The "Dirty Dozen" Attack Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write** to `/users/u1/floorplans/p1` (`request.auth == null`).
2. **Unverified email write or shared-doc read/edit** (`request.auth.token.email_verified == false`), including email-spoofing attempts against `/shared_floorplans/{shareId}`.
3. **Cross-user read (`get`/`list`)** by User B on `/users/userA/floorplans/p1`, or by User C (not in `sharedWithEmails`) on `/shared_floorplans/{shareId}`.
4. **Identity spoofing on create**: User A writes `/users/userA/floorplans/p1` or `/shared_floorplans/s1` with `ownerId: "userB"`.
5. **Cross-user path hijack**: User A writes `/users/userB/floorplans/p1` with `ownerId: "userA"`.
6. **Shadow/Ghost field injection**: Valid floorplan or shared floorplan payload plus `{ isAdmin: true }` or `{ publicShare: true }`.
7. **Timestamp forgery on create**: `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
8. **Immutable / owner-only field mutation on update**: Attempting to change `createdAt`, `ownerId`, or `sourcePlanId`, or a recipient attempting to mutate `sharedWithEmails` or escalate `accessLevel` from `'viewer'` to `'editor'`.
9. **Path ID poisoning**: `planId` or `shareId` containing `/` or `> 128` characters.
10. **String/Array DoS payload**: `projectName` with 5000 chars, `edges` with 500 items, `edges: []`, or `sharedWithEmails` with `[]` or 100 items.
11. **Type confusion & editor impersonation**: `ceilingHeightCm: "250"`, `accessLevel: "admin"`, or a recipient updating `lastEditedByEmail` to someone else's email.
12. **Viewer write & Orphaned share / Blanket list query**: A recipient writing to a `'viewer'` shared plan, creating `/shared_floorplans/{shareId}` pointing to another user's `sourcePlanId`, or querying `/shared_floorplans` without ownership/email membership.

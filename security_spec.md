# Security Specification & Payload-First TDD

## 1. Data Invariants
1. Every `/users/{userId}` document can only be read or written by the authenticated, email-verified user whose `request.auth.uid == userId`.
2. Every `/users/{userId}/floorplans/{planId}` document belongs strictly to `userId`, and `ownerId` must equal `request.auth.uid` on create and remain immutable on update.
3. Path variables (`userId`, `planId`) must pass `isValidId()` (`^[a-zA-Z0-9_-]+$`, `<= 128` chars) on single-document operations (`get`, `create`, `update`, `delete`).
4. `createdAt` must equal `request.time` on `create` and remain immutable on `update`; `updatedAt` must equal `request.time` on both `create` and `update`.
5. No ghost/shadow fields are allowed (`keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update).
6. List bounds (`edges.size() >= 1 && edges.size() <= 60`, `elements.size() <= 120`, `sharedWithEmails.size() >= 1 && sharedWithEmails.size() <= 20`) and string lengths (`projectName <= 100`, `analysisNotes <= 1000`) are strictly enforced to prevent resource exhaustion.
7. Every `/shared_floorplans/{shareId}` document can only be created/updated/deleted by its verified `ownerId == request.auth.uid`, must reference an existing `/users/{ownerId}/floorplans/{sourcePlanId}` owned by the creator on create, and can only be read (`get`/`list`) by the owner or a verified user whose lowercase token email appears in `sharedWithEmails`.

## 2. The "Dirty Dozen" Attack Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write** to `/users/u1/floorplans/p1` (`request.auth == null`).
2. **Unverified email write or shared-doc read** (`request.auth.token.email_verified == false`), including email-spoofing attempts against `/shared_floorplans/{shareId}`.
3. **Cross-user read (`get`/`list`)** by User B on `/users/userA/floorplans/p1`, or by User C (not in `sharedWithEmails`) on `/shared_floorplans/{shareId}`.
4. **Identity spoofing on create**: User A writes `/users/userA/floorplans/p1` or `/shared_floorplans/s1` with `ownerId: "userB"`.
5. **Cross-user path hijack**: User A writes `/users/userB/floorplans/p1` with `ownerId: "userA"`.
6. **Shadow/Ghost field injection**: Valid floorplan or shared floorplan payload plus `{ isAdmin: true }` or `{ publicShare: true }`.
7. **Timestamp forgery on create**: `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
8. **Immutable field mutation on update**: Attempting to change `createdAt`, `ownerId`, or `sourcePlanId` during `update`.
9. **Path ID poisoning**: `planId` or `shareId` containing `/` or `> 128` characters.
10. **String/Array DoS payload**: `projectName` with 5000 chars, `edges` with 500 items, `edges: []`, or `sharedWithEmails` with `[]` or 100 items.
11. **Type confusion**: `ceilingHeightCm: "250"` (string instead of number) or `unit: "yards"`.
12. **Orphaned share / Blanket list query**: Creating `/shared_floorplans/{shareId}` pointing to a non-existent or another user's `sourcePlanId`, or querying `/users/{otherUid}/floorplans` or `/shared_floorplans` without authorized ownership/email membership.


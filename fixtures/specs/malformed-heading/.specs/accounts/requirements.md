# accounts: requirements

Sign in and account protection.

## R1: Sign in with email
priority: must
status: approved
owner: someone

Users sign in with their email and password.

### Notes

Free-form content inside an item belongs to that item.

- Given a registered user
- When they submit the right password
- Then they are signed in
- And a session cookie is set

## R2: Lock out after failed attempts
priority: should
status: approved

- Given five failed sign-in attempts
- When a sixth attempt is made
- Then the account is locked for 15 minutes

## R3 Remember me
priority: could
status: draft

Not decided yet, so no task is needed.

## R4: Magic link sign-in
status: removed

Replaced by R1.

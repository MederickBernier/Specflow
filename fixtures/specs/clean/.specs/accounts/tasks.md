# accounts: tasks

## T1: Set up the auth module []
status: done
files: src/auth/index.ts

Module exists and is exported from `src/index.ts`.

## T2: Sign-in endpoint [R1]
status: done
files: src/auth/login.ts
depends: T1

Right password signs in, wrong password does not.

## T3: Add lockout counter [R2]
status: todo
files: src/auth/login.ts, src/auth/lockout.ts
depends: T2

Sixth attempt is refused for 15 minutes.

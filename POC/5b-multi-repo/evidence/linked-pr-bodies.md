## PR: acme/api (primary)
head: `feat/rename-get-user`  base: `main`  commit: `9f4aea39`

### Rename getUserV1 to fetchUser

Part of coordinated change set `cs_poc5b_rename_user`.

This PR must merge together with:
- secondary repo `acme/consumer` -> branch `feat/adopt-fetch-user`

---

## PR: acme/consumer (secondary)
head: `feat/adopt-fetch-user`  base: `main`  commit: `5a9cd413`

### Adopt api.fetchUser

Part of coordinated change set `cs_poc5b_rename_user`.

This PR must merge together with:
- primary repo `acme/api` -> branch `feat/rename-get-user`

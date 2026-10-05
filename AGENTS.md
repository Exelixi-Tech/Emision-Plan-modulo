# Project Rules & Customizations

## Bypass Nexus Tokens
When the user instructs to **"bypass nexus tokens"**:
- **Bypass NexusGuard in Frontend**: In `frontend/src/main.tsx`, render test components (such as `PersonasPlansTestForm`) or bypass `<NexusGuard>` when test views (`?view=personas`, `?test=personas`, `/personas`, etc.) are accessed so no Nexus SSO auth token is required.
- **Personas API v2 Settings**: In `frontend/src/lib/api.ts`, use the direct endpoint `https://nexusqa.exelixitech.com/nest-api-docs/api/v1/personas/planes` with header `apikey: 2b7dd2e40dad443a2e9ab4c9951f4489341184e7b6d1b3eb1241f39fb7572f2c` and default base payload:
  ```json
  {
    "cramo": 7,
    "ctipo": null,
    "citem": "215",
    "centidad": "P",
    "cproducto": "14",
    "cproductor": "215",
    "cusuario": "7",
    "cgestor_in": "marismendi@lamundialdeseguros.com",
    "cgestor": "80080-27-0"
  }
  ```
- **Port**: The frontend runs on port `5183` (`http://localhost:5183/?view=personas`).
